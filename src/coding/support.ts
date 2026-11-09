import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CodingServices } from '../engine/executor.js';
import type { EventLog } from '../engine/event-log.js';
import { ensureDir, writeFileAtomic } from '../shared/fs.js';
import type { CodingInfo, TaskRow } from '../storage/models.js';
import { taskDir } from '../storage/paths.js';
import type { Store } from '../storage/store.js';
import { git, gitText } from '../security/safe-git.js';
import { runProcess } from '../shared/process.js';
import { pathDirs, resolveExecutable } from '../security/safe-exec.js';
import { commandText, parseCommand } from './command.js';
import { detectTestCommand, inspectRepo, RepoError } from './repo.js';
import { renderCodingReport, testVerdict } from './report.js';
import { stripTestClaims } from './schemas.js';
import { ApprovedCommands, runProjectCommand, TestRunStore } from './test-runs.js';
import { WorktreeManager } from './worktrees.js';

export type Ask = (action: string, detail: unknown) => Promise<'approved' | 'denied' | 'defer'>;

export type PrepareResult = { state: 'ready'; task: TaskRow } | { state: 'defer' | 'denied'; task: TaskRow } | { state: 'failed'; task: TaskRow; error: string };

export interface ApplyOptions {
  merge?: boolean;
  pr?: boolean;
  /** Remote to push to (default "origin"). */
  remote?: string;
  signal?: AbortSignal;
}

export type ApplyResult =
  | { state: 'applied'; commit: string; merged: boolean; prUrl?: string; notes: string[] }
  | { state: 'defer' | 'denied' | 'nothing' | 'blocked'; reason: string; commit?: string };

const short = (s: string, n = 72): string => s.replace(/\s+/g, ' ').trim().slice(0, n);

export class CodingSupport {
  readonly worktrees: WorktreeManager;
  readonly tests: TestRunStore;
  readonly approved: ApprovedCommands;

  constructor(private readonly d: { store: Store; events: EventLog; homeDir: string }) {
    this.worktrees = new WorktreeManager(d.homeDir);
    this.tests = new TestRunStore(d.store);
    this.approved = new ApprovedCommands(d.store);
  }

  /** Look at the repository and work out what a coding task needs. Throws `RepoError` with a plain explanation. */
  async inspect(repoPath: string, opts: { testCommand?: string; setupCommand?: string }): Promise<{ info: CodingInfo; dirty: string[] }> {
    const state = await inspectRepo(repoPath);
    const flag = (c: string | undefined): string | null => (c ? commandText(parseCommand(c)) : null);
    const testCommand = flag(opts.testCommand) ?? detectTestCommand(state.root) ?? null;
    const setupCommand = flag(opts.setupCommand);
    // A command typed on the command line is the user's own approval of exactly that command.
    for (const c of [flag(opts.testCommand), setupCommand]) if (c) this.approved.approve(state.root, c);
    return { info: { repo: state.root, baseBranch: state.branch, baseSha: state.sha, worktree: null, branch: null, testCommand, setupCommand }, dirty: state.dirty };
  }

  /** Create the working copy, get the project commands approved, run setup, and record how the tests behave before any change. */
  async prepare(task: TaskRow, ask: Ask, signal?: AbortSignal): Promise<PrepareResult> {
    let t = task;
    const info = t.coding!;
    const fail = (error: string): PrepareResult => {
      this.d.events.emit(t.id, 'task.failed', { error });
      return { state: 'failed', error, task: this.d.store.updateTask(t.id, { status: 'failed', error }) };
    };
    try {
      if (!info.worktree || !existsSync(info.worktree)) {
        const w = await this.worktrees.create(info.repo, t.id, t.slug, info.baseSha);
        t = this.d.store.updateTask(t.id, { coding: { ...info, worktree: w.path, branch: w.branch } });
        this.d.events.emit(t.id, 'worktree.created', { branch: w.branch });
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    const coding = t.coding!;
    for (const [purpose, cmd] of [['setup', coding.setupCommand], ['tests', coding.testCommand]] as const) {
      if (!cmd || this.approved.isApproved(coding.repo, cmd)) continue;
      const decision = await ask('cmd.first_run', { command: cmd, purpose, repo: coding.repo });
      if (decision === 'approved') this.approved.approve(coding.repo, cmd);
      else return { state: decision, task: t };
    }
    const have = (phase: string): boolean => this.tests.list(t.id).some((r) => r.phase === phase);
    try {
      if (coding.setupCommand && !have('setup')) {
        this.d.events.emit(t.id, 'tests.setup', { command: coding.setupCommand });
        const s = await this.record(t.id, 'setup', coding.setupCommand, coding.worktree!, signal);
        if (!s.passed) return fail(`The setup command \`${coding.setupCommand}\` did not succeed (${s.timedOut ? 'ran too long' : `exit code ${s.exitCode}`}). End of its output:\n${s.output.slice(-1500)}`);
      }
      if (coding.testCommand && !have('baseline')) {
        const b = await this.record(t.id, 'baseline', coding.testCommand, coding.worktree!, signal);
        this.d.events.emit(t.id, 'tests.baseline', { passed: b.passed });
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    return { state: 'ready', task: t };
  }

  private async record(taskId: string, phase: string, command: string, cwd: string, signal?: AbortSignal) {
    const o = await runProjectCommand({ cwd, command, signal });
    return this.tests.add({
      taskId, phase, command: o.command, exitCode: o.exitCode, timedOut: o.timedOut, durationMs: o.durationMs,
      output: o.truncated ? `${o.output}\n[output was cut: the command printed more than Veritas keeps]` : o.output,
    });
  }

  services(task: TaskRow): CodingServices {
    const info = task.coding!;
    return {
      info: { ...info, worktree: info.worktree! },
      runTests: async (phase, signal) => {
        if (!info.testCommand) return null;
        const r = await this.record(task.id, phase, info.testCommand, info.worktree!, signal);
        this.d.events.emit(task.id, 'tests.ran', { phase, passed: r.passed });
        return r;
      },
      lastRun: (phase) => this.tests.list(task.id).filter((r) => r.phase.startsWith(phase)).at(-1),
    };
  }

  /** Describe the finished work and save the report. Nothing is committed. */
  async finish(task: TaskRow, output: { summary: string; notes: string }): Promise<string> {
    const info = task.coding!;
    const changes = await this.worktrees.changes(info.worktree!);
    const cleaned = stripTestClaims(output.summary);
    const notes = stripTestClaims(output.notes);
    const markdown = renderCodingReport({
      goal: task.goal, assumptions: task.assumptions, summary: cleaned.text, notes: notes.text, removedTestClaims: cleaned.removed + notes.removed,
      files: changes.files, stat: changes.stat, diff: changes.diff, diffTruncated: changes.truncated, runs: this.tests.list(task.id), info, taskId: task.id,
    });
    const dir = taskDir(this.d.homeDir, task.id);
    ensureDir(dir);
    const path = join(dir, 'result.md');
    writeFileAtomic(path, markdown);
    return path;
  }

  /**
   * Save the work as a commit, and optionally merge it or open a pull request. Every step asks first, every time.
   * The user's working folder is changed only by an approved merge, and only when it is on the right branch with nothing unsaved.
   */
  async apply(task: TaskRow, o: ApplyOptions, ask: Ask): Promise<ApplyResult> {
    const info = task.coding;
    if (!info?.worktree || !existsSync(info.worktree) || !info.branch) return { state: 'blocked', reason: 'This task has no working copy to apply (it may already have been applied or discarded).' };
    const changes = await this.worktrees.changes(info.worktree);
    const existingCommit = (await gitText(info.worktree, ['rev-parse', 'HEAD'], { readOnly: true })).trim();
    const alreadyCommitted = existingCommit !== info.baseSha;
    if (!changes.files.length && !alreadyCommitted) return { state: 'nothing', reason: 'The agent made no changes, so there is nothing to apply.' };
    const runs = this.tests.list(task.id);
    const notes: string[] = [];
    let commit = alreadyCommitted ? existingCommit : '';

    if (changes.files.length) {
      const decision = await ask('git.commit', {
        branch: info.branch, files: changes.files, stat: changes.stat, tests: testVerdict(runs, info.testCommand),
      });
      if (decision !== 'approved') return { state: decision, reason: decision === 'defer' ? 'Waiting for your approval to save the changes as a commit.' : 'You declined to save the changes.' };
      commit = await this.worktrees.commit(info.worktree, `${short(task.goal, 60)}\n\nMade by Veritas on branch ${info.branch}.\n${testVerdict(runs, info.testCommand).replace(/`/g, '')}`);
      this.d.events.emit(task.id, 'git.committed', { commit, branch: info.branch });
      notes.push(`Saved as commit ${commit.slice(0, 10)} on branch ${info.branch} in your repository.`);
    } else notes.push(`The changes were already saved as commit ${commit.slice(0, 10)} on branch ${info.branch}.`);

    let merged = false;
    if (o.merge) {
      const decision = await ask('git.merge', { branch: info.branch, into: info.baseBranch, repo: info.repo, tests: testVerdict(runs, info.testCommand) });
      if (decision !== 'approved') return { state: decision, commit, reason: decision === 'defer' ? 'Waiting for your approval to merge.' : 'You declined to merge.' };
      const m = await this.worktrees.merge(info.repo, info.branch, info.baseBranch, `Merge ${info.branch}: ${short(task.goal, 60)}`);
      if (!m.ok) return { state: 'blocked', commit, reason: `${m.reason}${m.conflicts.length ? ` Conflicting files: ${m.conflicts.join(', ')}.` : ''} The work is safe on branch ${info.branch}.` };
      merged = true;
      this.d.events.emit(task.id, 'git.merged', { into: info.baseBranch, commit: m.sha });
      notes.push(`Merged into ${info.baseBranch} (${m.sha.slice(0, 10)}).`);
    }

    let prUrl: string | undefined;
    if (o.pr) {
      const remote = o.remote ?? 'origin';
      const decision = await ask('git.push', { branch: info.branch, remote, openPullRequest: true, tests: testVerdict(runs, info.testCommand) });
      if (decision !== 'approved') return { state: decision, commit, reason: decision === 'defer' ? 'Waiting for your approval to push.' : 'You declined to push.' };
      const push = await git(info.repo, ['push', '--set-upstream', remote, info.branch], { timeoutMs: 120_000 });
      if (push.exitCode !== 0) return { state: 'blocked', commit, reason: `Pushing failed: ${(push.stderr || push.stdout).trim().slice(0, 300)}` };
      this.d.events.emit(task.id, 'git.pushed', { remote, branch: info.branch });
      notes.push(`Pushed ${info.branch} to ${remote}.`);
      const gh = resolveExecutable('gh', pathDirs());
      if (!gh) notes.push('The GitHub command-line tool (gh) was not found, so no pull request was opened. Open one from the pushed branch.');
      else {
        const pr = await runProcess(gh, ['pr', 'create', '--head', info.branch, '--base', info.baseBranch, '--title', short(task.goal, 70), '--body', `Made by Veritas.\n\n${testVerdict(runs, info.testCommand).replace(/`/g, '')}`],
          { cwd: info.repo, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }, timeoutMs: 60_000 });
        if (pr.exitCode === 0) { prUrl = pr.stdout.trim().split('\n').at(-1); notes.push(`Opened a pull request: ${prUrl}`); this.d.events.emit(task.id, 'git.pr', { url: prUrl }); }
        else notes.push(`The branch was pushed but the pull request could not be opened: ${pr.stderr.trim().slice(0, 200)}`);
      }
    }
    return { state: 'applied', commit, merged, prUrl, notes };
  }

  /** True when the task's branch holds commits beyond where it started (work the user may want to keep). */
  async hasSavedWork(task: TaskRow): Promise<boolean> {
    const info = task.coding;
    if (!info?.branch) return false;
    const n = await git(info.repo, ['rev-list', '--count', `${info.baseSha}..${info.branch}`], { readOnly: true });
    return n.exitCode === 0 && Number(n.stdout.trim()) > 0;
  }

  /** Remove the working copy (and its branch unless it holds a saved commit the user may want). */
  async discard(task: TaskRow, deleteBranch: boolean): Promise<void> {
    const info = task.coding;
    if (!info?.worktree) return;
    await this.worktrees.remove(info.repo, info.worktree, info.branch, deleteBranch);
    this.d.store.updateTask(task.id, { coding: { ...info, worktree: null, branch: deleteBranch ? null : info.branch } });
    this.d.events.emit(task.id, 'worktree.removed', { deleteBranch });
  }
}

