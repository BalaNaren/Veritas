import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectRepo } from '../../src/coding/repo.js';
import { MAX_CHANGED_FILES, WorktreeManager } from '../../src/coding/worktrees.js';
import { BUGGY_PROJECT, makeRepo, sh } from './helpers.js';

const cleanup: string[] = [];
afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });

function setup() {
  const repo = makeRepo(BUGGY_PROJECT);
  const home = mkdtempSync(join(tmpdir(), 'veritas-wt-home-'));
  cleanup.push(repo, home);
  return { repo, home, wt: new WorktreeManager(home) };
}
const hash = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('WorktreeManager', () => {
  it('makes a separate working copy on a Veritas branch and leaves the user\'s folder alone', async () => {
    const { repo, home, wt } = setup();
    writeFileSync(join(repo, 'add.js'), '// my unsaved work\n');             // uncommitted change in the user's folder
    const before = { add: hash(join(repo, 'add.js')), status: sh(repo, 'status', '--porcelain'), head: sh(repo, 'rev-parse', 'HEAD') };
    const state = await inspectRepo(repo);
    const w = await wt.create(repo, 'task_0123456789abcdef', 'Fix the add function', state.sha);

    expect(w.path).toBe(join(home, 'worktrees', 'task_0123456789abcdef'));
    expect(w.branch).toBe('veritas/fix-the-add-function-89abcdef');
    expect(readFileSync(join(w.path, 'add.js'), 'utf8')).toContain('a - b');   // starts from the committed state, not the unsaved edit
    expect(sh(repo, 'worktree', 'list')).toContain(w.path);

    writeFileSync(join(w.path, 'add.js'), 'export const add = (a, b) => a + b;\n');
    writeFileSync(join(w.path, 'new.txt'), 'new file');
    expect({ add: hash(join(repo, 'add.js')), status: sh(repo, 'status', '--porcelain'), head: sh(repo, 'rev-parse', 'HEAD') }).toEqual(before);
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
  });

  it('describes the changes, including new files, and refuses to sweep in an unreasonable number', async () => {
    const { repo, wt } = setup();
    const w = await wt.create(repo, 'task_aaaaaaaaaaaaaaaa', 'x', (await inspectRepo(repo)).sha);
    writeFileSync(join(w.path, 'add.js'), 'export const add = (a, b) => a + b;\n');
    writeFileSync(join(w.path, 'new.txt'), 'hello\n');
    const c = await wt.changes(w.path);
    expect(c.files.sort()).toEqual(['add.js', 'new.txt']);
    expect(c.stat).toContain('add.js');
    expect(c.diff).toContain('+export const add = (a, b) => a + b;');
    expect(c.truncated).toBe(false);

    mkdirSync(join(w.path, 'junk'));
    for (let i = 0; i <= MAX_CHANGED_FILES; i++) writeFileSync(join(w.path, 'junk', `f${i}.txt`), 'x');
    await expect(wt.changes(w.path)).rejects.toThrow(/more than 500 files/);
  });

  it('merges a committed branch only into the branch it started from, and only when the folder is clean', async () => {
    const { repo, wt } = setup();
    const w = await wt.create(repo, 'task_bbbbbbbbbbbbbbbb', 'fix', (await inspectRepo(repo)).sha);
    writeFileSync(join(w.path, 'add.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
    await wt.changes(w.path);
    const commit = await wt.commit(w.path, 'Fix add');
    expect(sh(repo, 'rev-parse', 'main')).not.toBe(commit);                    // nothing on main yet

    writeFileSync(join(repo, 'scratch.txt'), 'unsaved');
    const dirty = await wt.merge(repo, w.branch, 'main', 'Merge');
    expect(dirty).toMatchObject({ ok: false });
    expect(!dirty.ok && dirty.reason).toMatch(/uncommitted change/);
    rmSync(join(repo, 'scratch.txt'));

    sh(repo, 'checkout', '-q', '-b', 'other');
    const wrong = await wt.merge(repo, w.branch, 'main', 'Merge');
    expect(!wrong.ok && wrong.reason).toMatch(/not "main"/);
    sh(repo, 'checkout', '-q', 'main');

    const merged = await wt.merge(repo, w.branch, 'main', 'Merge veritas work');
    expect(merged.ok).toBe(true);
    expect(readFileSync(join(repo, 'add.js'), 'utf8')).toContain('a + b');
    expect(sh(repo, 'log', '-1', '--format=%s')).toBe('Merge veritas work');
  });

  it('stops cleanly on a conflict: nothing merged, the user\'s folder exactly as it was', async () => {
    const { repo, wt } = setup();
    const w = await wt.create(repo, 'task_cccccccccccccccc', 'fix', (await inspectRepo(repo)).sha);
    writeFileSync(join(w.path, 'add.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
    await wt.changes(w.path);
    await wt.commit(w.path, 'Fix add');
    writeFileSync(join(repo, 'add.js'), 'export function add(a, b) {\n  return b - a; // someone else changed this too\n}\n');
    sh(repo, 'commit', '-q', '-am', 'other change');
    const head = sh(repo, 'rev-parse', 'HEAD');
    const r = await wt.merge(repo, w.branch, 'main', 'Merge');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.conflicts).toEqual(['add.js']);
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(sh(repo, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(repo, 'add.js'), 'utf8')).toContain('someone else changed this too');
  });

  it('commits as the user when git knows them, and as "Veritas" when it does not', async () => {
    const { repo, wt } = setup();
    const w = await wt.create(repo, 'task_dddddddddddddddd', 'x', (await inspectRepo(repo)).sha);
    writeFileSync(join(w.path, 'a.txt'), 'a');
    await wt.changes(w.path);
    await wt.commit(w.path, 'one');
    expect(sh(w.path, 'log', '-1', '--format=%an <%ae>')).toBe('Test User <test@example.com>');

    sh(repo, 'config', '--unset', 'user.name'); sh(repo, 'config', '--unset', 'user.email');
    const oldHome = process.env.HOME;
    process.env.HOME = mkdtempSync(join(tmpdir(), 'veritas-nohome-'));
    cleanup.push(process.env.HOME);
    try {
      writeFileSync(join(w.path, 'b.txt'), 'b');
      await wt.changes(w.path);
      await wt.commit(w.path, 'two');
    } finally { process.env.HOME = oldHome; }
    expect(sh(w.path, 'log', '-1', '--format=%an <%ae>')).toBe('Veritas <veritas@localhost>');
  });

  it('takes turns when used at the same time, and steals a lock left by a dead process', async () => {
    const { repo, home, wt } = setup();
    const sha = (await inspectRepo(repo)).sha;
    const results = await Promise.all([wt.create(repo, 'task_e1e1e1e1e1e1e1e1', 'a', sha), wt.create(repo, 'task_e2e2e2e2e2e2e2e2', 'b', sha), wt.create(repo, 'task_e3e3e3e3e3e3e3e3', 'c', sha)]);
    expect(new Set(results.map((r) => r.path)).size).toBe(3);
    mkdirSync(join(home, 'worktrees'), { recursive: true });
    writeFileSync(join(home, 'worktrees', '.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
    const w = await wt.create(repo, 'task_f1f1f1f1f1f1f1f1', 'd', sha);
    expect(existsSync(w.path)).toBe(true);
    expect(existsSync(join(home, 'worktrees', '.lock'))).toBe(false);
  });

  it('removes the working copy and the branch, but only a branch it created', async () => {
    const { repo, wt } = setup();
    const w = await wt.create(repo, 'task_99999999999999aa', 'x', (await inspectRepo(repo)).sha);
    await expect(wt.remove(repo, w.path, 'main', true)).rejects.toThrow(/only deletes branches it created/);
    await wt.remove(repo, w.path, w.branch, true);
    expect(existsSync(w.path)).toBe(false);
    expect(sh(repo, 'branch', '--list', w.branch)).toBe('');
    expect(sh(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(sh(repo, 'branch', '--list', 'main')).toContain('main');
  });
});
