import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitText } from '../security/safe-git.js';
import { slugify } from '../shared/ids.js';
import { inspectRepo, RepoError } from './repo.js';

/** A cap on what one task may stage, so build outputs that are not ignored cannot be swept in by accident. */
export const MAX_CHANGED_FILES = 500;
export const MAX_DIFF_BYTES = 400_000;
const LOCK_STALE_MS = 5 * 60_000;

export interface WorktreeInfo { path: string; branch: string }

const identityEnv = (name: string, email: string): Record<string, string> => ({
  GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
});

/**
 * Separate working copies for coding tasks. The agent works in `<home>/worktrees/<task>` on a new `veritas/...`
 * branch cut from the commit that was checked out when the task began. The user's own working folder is never
 * edited; the only things that change in their repository are git's own records of the extra copy and branch.
 */
export class WorktreeManager {
  constructor(private readonly home: string) {}

  private get root(): string { return join(this.home, 'worktrees'); }
  pathFor(taskId: string): string { return join(this.root, taskId); }
  branchFor(slug: string, taskId: string): string { return `veritas/${slugify(slug, 30)}-${taskId.slice(-8)}`; }

  /** Run `fn` while holding a lock, so two Veritas processes do not change worktrees at once. */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const lock = join(this.root, '.lock');
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        const fd = openSync(lock, 'wx', 0o600);
        writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
        closeSync(fd);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        if (this.lockIsStale(lock)) { rmSync(lock, { force: true }); continue; }
        if (Date.now() > deadline) throw new RepoError('Another Veritas process is changing working copies right now. Try again in a moment.');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    try { return await fn(); } finally { rmSync(lock, { force: true }); }
  }

  private lockIsStale(lock: string): boolean {
    try {
      const { pid, at } = JSON.parse(readFileSync(lock, 'utf8')) as { pid: number; at: number };
      if (Date.now() - at > LOCK_STALE_MS) return true;
      try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
    } catch { return true; }
  }

  async create(repo: string, taskId: string, slug: string, baseSha: string): Promise<WorktreeInfo> {
    const path = this.pathFor(taskId);
    const branch = this.branchFor(slug, taskId);
    return this.withLock(async () => {
      if (existsSync(path)) throw new RepoError(`A working copy already exists at ${path}.`);
      const r = await git(repo, ['worktree', 'add', '-b', branch, path, baseSha]);
      if (r.exitCode !== 0) throw new RepoError(`Could not create the working copy: ${r.stderr.trim().slice(0, 300)}`);
      return { path, branch };
    });
  }

  /** Stage everything in the working copy and describe it. Refuses to stage an unreasonable amount. */
  async changes(worktree: string): Promise<{ files: string[]; stat: string; diff: string; truncated: boolean }> {
    const untracked = (await gitText(worktree, ['ls-files', '--others', '--exclude-standard'], { readOnly: true })).split('\n').filter(Boolean);
    const modified = (await gitText(worktree, ['diff', '--name-only'], { readOnly: true })).split('\n').filter(Boolean);
    if (untracked.length + modified.length > MAX_CHANGED_FILES) {
      throw new RepoError(`The change touches more than ${MAX_CHANGED_FILES} files. Build outputs or installed packages are probably not ignored by the project's .gitignore.`);
    }
    const add = await git(worktree, ['add', '-A']);
    if (add.exitCode !== 0) throw new RepoError(`Could not stage the changes: ${add.stderr.trim().slice(0, 300)}`);
    const files = (await gitText(worktree, ['diff', '--cached', '--name-only'], { readOnly: true })).split('\n').filter(Boolean);
    const stat = await gitText(worktree, ['diff', '--cached', '--stat'], { readOnly: true });
    const full = await git(worktree, ['diff', '--cached', '--no-color'], { readOnly: true, maxOutputBytes: MAX_DIFF_BYTES * 4 });
    const diff = full.stdout.length > MAX_DIFF_BYTES ? full.stdout.slice(0, MAX_DIFF_BYTES) : full.stdout;
    return { files, stat, diff, truncated: full.stdout.length > MAX_DIFF_BYTES || full.truncated };
  }

  /** Save the staged changes as a commit on the task branch. The caller must have been given approval. */
  async commit(worktree: string, message: string): Promise<string> {
    const name = (await git(worktree, ['config', 'user.name'], { readOnly: true })).stdout.trim();
    const email = (await git(worktree, ['config', 'user.email'], { readOnly: true })).stdout.trim();
    const env = name && email ? undefined : identityEnv(name || 'Veritas', email || 'veritas@localhost');
    const r = await git(worktree, ['commit', '-m', message], { env });
    if (r.exitCode !== 0) throw new RepoError(`Could not commit: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    return gitText(worktree, ['rev-parse', 'HEAD'], { readOnly: true });
  }

  /**
   * Merge the task branch into the branch the user started from. This is the one step that edits the user's own
   * working folder, so it refuses unless that branch is checked out and the folder has no uncommitted changes.
   */
  async merge(repo: string, branch: string, expectedBranch: string, message: string): Promise<{ ok: true; sha: string } | { ok: false; reason: string; conflicts: string[] }> {
    return this.withLock(async () => {
      const state = await inspectRepo(repo);
      if (state.branch !== expectedBranch) return { ok: false, reason: `Your repository is on "${state.branch}", not "${expectedBranch}". Check out "${expectedBranch}" and try again.`, conflicts: [] };
      if (state.dirty.length) return { ok: false, reason: `Your working folder has ${state.dirty.length} uncommitted change(s). Commit or stash them first; Veritas will not merge into unsaved work.`, conflicts: [] };
      const name = (await git(repo, ['config', 'user.name'], { readOnly: true })).stdout.trim();
      const email = (await git(repo, ['config', 'user.email'], { readOnly: true })).stdout.trim();
      const env = name && email ? undefined : identityEnv(name || 'Veritas', email || 'veritas@localhost');
      const r = await git(repo, ['merge', '--no-ff', '-m', message, branch], { env });
      if (r.exitCode === 0) return { ok: true, sha: await gitText(repo, ['rev-parse', 'HEAD'], { readOnly: true }) };
      const conflicts = (await gitText(repo, ['diff', '--name-only', '--diff-filter=U'], { readOnly: true }).catch(() => '')).split('\n').filter(Boolean);
      await git(repo, ['merge', '--abort']);
      return { ok: false, reason: conflicts.length ? 'The changes conflict with newer changes on your branch. Nothing was merged and your folder is as it was.' : `The merge failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, conflicts };
    });
  }

  /** Remove the working copy, and optionally its branch. */
  async remove(repo: string, worktree: string, branch: string | null, deleteBranch: boolean): Promise<void> {
    if (deleteBranch && branch && !branch.startsWith('veritas/')) throw new RepoError('Veritas only deletes branches it created.');
    await this.withLock(async () => {
      await git(repo, ['worktree', 'remove', '--force', worktree]);
      rmSync(worktree, { recursive: true, force: true });
      await git(repo, ['worktree', 'prune']);
      if (deleteBranch && branch) await git(repo, ['branch', '-D', branch]);
    });
  }
}
