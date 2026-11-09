import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRunRequest, AgentRunResult, ModelProvider } from '../../src/agents/provider.js';
import { defaultConfig } from '../../src/config.js';
import { Engine, type Approver } from '../../src/engine/engine.js';
import { Policy } from '../../src/policy/policy.js';
import { pathDirs, resolveExecutable } from '../../src/security/safe-exec.js';
import { Store } from '../../src/storage/store.js';
import { BUGGY_PROJECT, makeRepo, sh } from './helpers.js';

const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });

const FIXED = 'export function add(a, b) {\n  return a + b;\n}\n';
const WRONG = 'export function add(a, b) {\n  return a * b;\n}\n';
const ok = (over: Partial<AgentRunResult>): AgentRunResult => ({
  ok: true, text: '', costUsd: 0.05, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 1, numTurns: 1, ...over,
});

/** An agent that edits real files in the folder it is given, one version of add.js per round. */
function agent(versions: string[], summary = 'Changed add to return a + b. All tests pass now.') {
  const calls: AgentRunRequest[] = [];
  const provider: ModelProvider = {
    id: 'claude-code',
    async run(r) {
      calls.push(r);
      const v = versions[Math.min(calls.length, versions.length) - 1]!;
      writeFileSync(join(r.cwd, 'add.js'), v);
      return ok({ json: { summary, notes: '' } });
    },
  };
  return { provider, calls };
}

function setup(provider: ModelProvider, files = BUGGY_PROJECT, policy?: Policy) {
  const repo = makeRepo(files);
  const home = mkdtempSync(join(tmpdir(), 'veritas-code-home-'));
  cleanup.push(repo, home);
  const store = Store.open(':memory:');
  const engine = new Engine({ store, provider, config: { ...defaultConfig(home), maxConcurrent: 1 }, policy, retryDelayMs: 0, sandbox: async () => undefined });
  return { repo, home, store, engine };
}
const yes: Approver = async () => 'approved';
const hash = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const mine = (t: { repo: string }) => ({ add: hash(join(t.repo, 'add.js')), status: sh(t.repo, 'status', '--porcelain'), head: sh(t.repo, 'rev-parse', 'HEAD'), branches: sh(t.repo, 'branch', '--format=%(refname:short)') });

describe('coding tasks', () => {
  it('makes the change in a separate copy, runs the tests itself, and leaves the user\'s folder untouched', async () => {
    const { provider, calls } = agent([FIXED]);
    const t = setup(provider);
    const before = mine(t);
    const task = await t.engine.createCodingTask('Fix add so it adds', { repo: t.repo, testCommand: 'node --test' });
    const r = await t.engine.execute(task.id, { approver: yes });
    expect(r.task.error).toBeNull();
    expect(r.task.status).toBe('done');
    expect(r.task.type).toBe('coding');

    // The agent worked in the separate copy, with edit tools and exactly the approved test command.
    const info = r.task.coding!;
    expect(calls[0]!.cwd).toBe(info.worktree);
    expect(calls[0]!.cwd.startsWith(t.repo)).toBe(false);
    expect(calls[0]!.tools).toEqual(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash']);
    // Every file tool is limited to the working copy by path (a bare tool name works anywhere on the computer).
    const scope = `//${realpathSync(info.worktree!).replace(/^\/+/, '')}/**`;
    expect(calls[0]!.allowedTools).toEqual([`Read(${scope})`, `Edit(${scope})`, `Write(${scope})`, `Grep(${scope})`, `Glob(${scope})`, 'Bash(node --test)']);
    expect(calls[0]!.allowedTools!.some((t) => ['Read', 'Edit', 'Write', 'Grep', 'Glob'].includes(t))).toBe(false);
    expect(calls[0]!.prompt).toContain('failed (exit code 1)');   // it was told the tests failed before its change

    // The user's folder and branches are exactly as they were, apart from the new Veritas branch.
    const after = mine(t);
    expect({ ...after, branches: undefined }).toEqual({ ...before, branches: undefined });
    expect(after.branches.split('\n').filter((b) => b.startsWith('veritas/'))).toEqual([info.branch]);
    expect(readFileSync(join(info.worktree!, 'add.js'), 'utf8')).toBe(FIXED);
    expect(sh(info.worktree!, 'rev-parse', 'HEAD')).toBe(before.head);       // nothing committed anywhere

    // Test results are Veritas's own recorded runs.
    const runs = t.store.db.prepare('SELECT phase, exit_code FROM test_runs ORDER BY started_at, rowid').all() as { phase: string; exit_code: number }[];
    expect(runs).toEqual([{ phase: 'baseline', exit_code: 1 }, { phase: 'round1', exit_code: 0 }]);

    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).toContain('The tests passed after the change: Veritas ran `node --test` and it exited with code 0. Before the change they were failing.');
    expect(md).toContain('+  return a + b;');
    expect(md).toContain('1 sentence(s) in the agent\'s description that made claims about test results were removed');
    expect(md).not.toContain('All tests pass now');
    expect(md).toContain('Nothing has been committed, merged or pushed');
  });

  it('sends a failing test run back to the agent and reports only what the runs show', async () => {
    const { provider, calls } = agent([WRONG, FIXED], 'Tried a multiplication.');
    const t = setup(provider);
    const task = await t.engine.createCodingTask('Fix add', { repo: t.repo, testCommand: 'node --test' });
    const r = await t.engine.execute(task.id, { approver: yes });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('did not pass');
    expect(calls[1]!.prompt).toMatch(/not ok|fail/i);
    const phases = (t.store.db.prepare('SELECT phase, exit_code FROM test_runs ORDER BY started_at, rowid').all() as { phase: string; exit_code: number }[]).map((x) => `${x.phase}:${x.exit_code}`);
    expect(phases).toEqual(['baseline:1', 'round1:1', 'round2:0']);
    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).toContain('After the change, round 1');
    expect(md).toContain('After the change, round 2');
    expect(md).toContain('failed (exit code 1)');
  });

  it('says plainly when the tests never pass, after three rounds', async () => {
    const { provider, calls } = agent([WRONG]);
    const t = setup(provider);
    const task = await t.engine.createCodingTask('Fix add', { repo: t.repo, testCommand: 'node --test' });
    const r = await t.engine.execute(task.id, { approver: yes });
    expect(r.task.status).toBe('done');
    expect(calls).toHaveLength(3);
    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).toContain('The tests did NOT pass after the change');
    expect(md).toContain('Do not merge this without looking into why');
    expect(md).not.toContain('The tests passed');
  });

  it('is honest when there is no way to run tests', async () => {
    const { provider, calls } = agent([FIXED]);
    const t = setup(provider, { 'add.js': 'export function add(a, b) {\n  return a - b;\n}\n' });
    const task = await t.engine.createCodingTask('Fix add', { repo: t.repo });
    const r = await t.engine.execute(task.id, { approver: yes });
    expect(calls[0]!.allowedTools!.every((t) => /^(Read|Edit|Write|Grep|Glob)\(\/\/.+\/\*\*\)$/.test(t))).toBe(true);
    expect(calls[0]!.allowedTools).toHaveLength(5);
    expect(calls[0]!.tools).not.toContain('Bash');
    expect(readFileSync(r.resultPath!, 'utf8')).toContain('No tests were run');
  });

  it('keeps the user\'s unsaved work out of the copy and says so', async () => {
    const { provider } = agent([FIXED]);
    const t = setup(provider);
    writeFileSync(join(t.repo, 'add.js'), '// my unsaved experiment\n');
    const task = await t.engine.createCodingTask('Fix add', { repo: t.repo, testCommand: 'node --test' });
    expect(task.assumptions[0]).toContain('1 uncommitted change(s) are not included');
    await t.engine.execute(task.id, { approver: yes });
    expect(readFileSync(join(t.repo, 'add.js'), 'utf8')).toBe('// my unsaved experiment\n');
  });

  it('refuses a folder that is not a usable repository, and a command that needs a shell', async () => {
    const t = setup(agent([FIXED]).provider);
    await expect(t.engine.createCodingTask('x', { repo: tmpdir() })).rejects.toThrow(/not inside a git repository|no commits/);
    await expect(t.engine.createCodingTask('x', { repo: t.repo, testCommand: 'node --test && rm -rf /' })).rejects.toThrow(/needs a shell/);
  });
});

const hasNpm = !!resolveExecutable('npm', pathDirs());
describe.skipIf(!hasNpm)('approving a detected test command', () => {
  it('asks once per project before running it, then remembers', async () => {
    const { provider } = agent([FIXED]);
    const t = setup(provider);
    const task = await t.engine.createCodingTask('Fix add', { repo: t.repo });          // npm test is detected, not given by the user
    expect(task.coding!.testCommand).toBe('npm test');
    const first = await t.engine.execute(task.id, { approver: async ({ approval }) => (approval.action === 'plan.start' ? 'approved' : 'defer') });
    expect(first.task.status).toBe('awaiting_approval');
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM test_runs').get()).toMatchObject({ n: 0 });   // nothing ran yet
    const pending = t.store.listApprovals(task.id, 'pending');
    expect(pending.map((a) => a.action)).toEqual(['cmd.first_run']);
    expect(pending[0]!.detail).toMatchObject({ command: 'npm test', purpose: 'tests' });
    t.engine.decide(pending[0]!.id, 'approved');
    const second = await t.engine.execute(task.id, { approver: yes });
    expect(second.task.status).toBe('done');

    const again = await t.engine.createCodingTask('Another change', { repo: t.repo });
    const asked: string[] = [];
    await t.engine.execute(again.id, { approver: async ({ approval }) => { asked.push(approval.action); return 'approved'; } });
    expect(asked).not.toContain('cmd.first_run');
  });

  it('stops without running anything when the command is declined', async () => {
    const t = setup(agent([FIXED]).provider);
    const task = await t.engine.createCodingTask('Fix add', { repo: t.repo });
    const r = await t.engine.execute(task.id, { approver: async ({ approval }) => (approval.action === 'cmd.first_run' ? 'denied' : 'approved') });
    expect(r.task.status).toBe('cancelled');
    expect(t.store.db.prepare('SELECT COUNT(*) AS n FROM test_runs').get()).toMatchObject({ n: 0 });
  });
});

describe('applying the work', () => {
  async function finished() {
    const { provider } = agent([FIXED]);
    const t = setup(provider);
    const task = await t.engine.createCodingTask('Fix add so it adds', { repo: t.repo, testCommand: 'node --test' });
    const r = await t.engine.execute(task.id, { approver: yes });
    return { ...t, task: r.task };
  }

  it('asks before saving a commit, and a flag cannot approve it in advance', async () => {
    const t = await finished();
    const deferred = await t.engine.apply(t.task.id, {});
    expect(deferred).toMatchObject({ state: 'defer' });
    const pending = t.store.listApprovals(t.task.id, 'pending');
    expect(pending.map((a) => a.action)).toEqual(['git.commit']);
    expect(pending[0]!.detail).toMatchObject({ files: ['add.js'] });
    expect(sh(t.task.coding!.worktree!, 'rev-parse', 'HEAD')).toBe(t.task.coding!.baseSha);

    expect(new Policy().withAllowed(['git.commit', 'git.merge', 'git.push'], 'flag').evaluate('git.commit').decision).toBe('ask');
    expect(new Policy().withAllowed(['git.merge'], 'flag').evaluate('git.merge').decision).toBe('ask');
    expect(new Policy().withAllowed(['git.push'], 'flag').evaluate('git.push').decision).toBe('ask');

    const declined = await t.engine.apply(t.task.id, {}, async () => 'denied');
    expect(declined).toMatchObject({ state: 'denied' });
    expect(sh(t.task.coding!.worktree!, 'rev-parse', 'HEAD')).toBe(t.task.coding!.baseSha);
  });

  it('commits after approval given later, and uses that approval only once', async () => {
    const t = await finished();
    await t.engine.apply(t.task.id, {});
    t.engine.decide(t.store.listApprovals(t.task.id, 'pending')[0]!.id, 'approved');
    const r = await t.engine.apply(t.task.id, {});
    expect(r).toMatchObject({ state: 'applied', merged: false });
    const branch = t.task.coding!.branch!;
    expect(sh(t.repo, 'log', '-1', '--format=%s', branch)).toContain('Fix add so it adds');
    expect(sh(t.repo, 'log', '-1', '--format=%B', branch)).toContain('The tests passed after the change');
    expect(sh(t.repo, 'rev-parse', 'main')).toBe(t.task.coding!.baseSha);      // the user's branch is still where it was
    // A later apply with new changes needs a new approval.
    writeFileSync(join(t.task.coding!.worktree!, 'extra.txt'), 'more');
    expect(await t.engine.apply(t.task.id, {})).toMatchObject({ state: 'defer' });
  });

  it('merges only with its own approval, only into a clean folder on the right branch', async () => {
    const t = await finished();
    const asked: string[] = [];
    const approver: Approver = async ({ approval }) => { asked.push(approval.action); return 'approved'; };
    writeFileSync(join(t.repo, 'scratch.txt'), 'unsaved');
    const blocked = await t.engine.apply(t.task.id, { merge: true }, approver);
    expect(blocked).toMatchObject({ state: 'blocked' });
    expect((blocked as { reason: string }).reason).toMatch(/uncommitted change/);
    expect(sh(t.repo, 'rev-parse', 'main')).toBe(t.task.coding!.baseSha);
    rmSync(join(t.repo, 'scratch.txt'));

    const done = await t.engine.apply(t.task.id, { merge: true }, approver);
    expect(done).toMatchObject({ state: 'applied', merged: true });
    expect(asked).toEqual(['git.commit', 'git.merge', 'git.merge']);   // the blocked attempt asked for its own merge approval
    expect(readFileSync(join(t.repo, 'add.js'), 'utf8')).toBe(FIXED);
    expect(sh(t.repo, 'status', '--porcelain')).toBe('');
  });

  it('pushes only a Veritas branch to a remote, after approval', async () => {
    const t = await finished();
    const remote = mkdtempSync(join(tmpdir(), 'veritas-remote-'));
    cleanup.push(remote);
    sh(remote, 'init', '-q', '--bare', '-b', 'main');
    sh(t.repo, 'remote', 'add', 'origin', remote);
    const asked: string[] = [];
    const r = await t.engine.apply(t.task.id, { pr: true }, async ({ approval }) => { asked.push(approval.action); return 'approved'; });
    expect(asked).toEqual(['git.commit', 'git.push']);
    expect(r.state).toBe('applied');
    expect(sh(remote, 'branch', '--list')).toContain(t.task.coding!.branch!);
    expect(sh(remote, 'branch', '--list')).not.toContain('main');
  });

  it('discards the copy, keeping the branch only if it holds saved work', async () => {
    const unsaved = await finished();
    const w = unsaved.task.coding!.worktree!;
    expect(await unsaved.engine.discard(unsaved.task.id)).toEqual({ keptBranch: null });
    expect(existsSync(w)).toBe(false);
    expect(sh(unsaved.repo, 'branch', '--list', unsaved.task.coding!.branch!)).toBe('');

    const saved = await finished();
    await saved.engine.apply(saved.task.id, {}, yes);
    const kept = await saved.engine.discard(saved.task.id);
    expect(kept.keptBranch).toBe(saved.task.coding!.branch);
    expect(sh(saved.repo, 'branch', '--list', saved.task.coding!.branch!)).toContain('veritas/');
    expect(existsSync(saved.task.coding!.worktree!)).toBe(false);
  });
});
