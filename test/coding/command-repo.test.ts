import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandText, CommandError, parseCommand } from '../../src/coding/command.js';
import { detectTestCommand, inspectRepo, RepoError } from '../../src/coding/repo.js';
import { GitDeniedError, gitArgv } from '../../src/security/safe-git.js';
import { BUGGY_PROJECT, makeRepo, sh } from './helpers.js';

describe('parseCommand', () => {
  it('splits plain commands and quoted words', () => {
    expect(parseCommand('npm test')).toEqual(['npm', 'test']);
    expect(parseCommand('  python3 -m pytest -k "my test"  ')).toEqual(['python3', '-m', 'pytest', '-k', 'my test']);
    expect(parseCommand("node --test 'a b.js'")).toEqual(['node', '--test', 'a b.js']);
    expect(commandText(['node', '--test', 'a b.js'])).toBe('node --test "a b.js"');
  });
  it.each(['npm test && rm -rf /', 'npm test; id', 'npm test | tee x', 'npm test > out', 'echo $HOME', 'echo `id`', 'FOO=1 npm test', 'npm test $(id)', 'rm -rf ~', 'ls *', 'a\nb', 'npm test #x'])(
    'refuses what needs a shell: %j', (cmd) => expect(() => parseCommand(cmd)).toThrow(CommandError));
  it('refuses empty, unclosed and oversized commands', () => {
    expect(() => parseCommand('   ')).toThrow(/empty/);
    expect(() => parseCommand('npm "test')).toThrow(/unclosed/);
    expect(() => parseCommand('a'.repeat(501))).toThrow(/too long/);
  });
});

describe('detectTestCommand', () => {
  const dir = (files: Record<string, string>): string => { const d = mkdtempSync(join(tmpdir(), 'veritas-det-')); for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c); return d; };
  it('recognises common projects and ignores the default placeholder', () => {
    const made: string[] = [];
    const check = (files: Record<string, string>): string | undefined => { const d = dir(files); made.push(d); return detectTestCommand(d); };
    expect(check({ 'package.json': '{"scripts":{"test":"vitest run"}}' })).toBe('npm test');
    expect(check({ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })).toBeUndefined();
    expect(check({ 'Cargo.toml': '' })).toBe('cargo test');
    expect(check({ 'go.mod': '' })).toBe('go test ./...');
    expect(check({ 'pytest.ini': '' })).toBe('python3 -m pytest');
    expect(check({ Makefile: 'build:\n\tx\ntest:\n\ty\n' })).toBe('make test');
    expect(check({ 'README.md': '' })).toBeUndefined();
    made.forEach((d) => rmSync(d, { recursive: true, force: true }));
  });
});

describe('inspectRepo', () => {
  it('reports the branch, the commit and uncommitted changes without changing anything', async () => {
    const repo = makeRepo(BUGGY_PROJECT);
    const clean = await inspectRepo(repo);
    expect(clean).toMatchObject({ root: repo, branch: 'main', dirty: [] });
    expect(clean.sha).toBe(sh(repo, 'rev-parse', 'HEAD'));
    writeFileSync(join(repo, 'add.js'), 'changed');
    expect((await inspectRepo(repo)).dirty).toEqual([' M add.js']);
    expect(sh(repo, 'status', '--porcelain')).toBe('M add.js');
  });
  it('explains what is wrong when it is not a usable repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'veritas-plain-'));
    await expect(inspectRepo(plain)).rejects.toThrow(/not inside a git repository/);
    await expect(inspectRepo(join(plain, 'missing'))).rejects.toBeInstanceOf(RepoError);
    const detached = makeRepo(BUGGY_PROJECT);
    sh(detached, 'checkout', '-q', '--detach');
    await expect(inspectRepo(detached)).rejects.toThrow(/detached/);
  });
});

describe('hardened git: push and remote', () => {
  const ok = (...a: string[]): string[] => gitArgv('/tmp/r', a);
  it('allows only the exact push Veritas makes', () => {
    expect(ok('push', '--set-upstream', 'origin', 'veritas/fix-abc12345')).toContain('push');
    for (const bad of [
      ['push'], ['push', 'origin', 'veritas/x'], ['push', '--force', 'origin', 'veritas/x'], ['push', '--set-upstream', 'origin', 'main'],
      ['push', '--set-upstream', 'origin', 'veritas/x', '--force'], ['push', '--set-upstream', 'origin', ':veritas/x'], ['push', '--set-upstream', 'origin', 'veritas/../main'],
      ['push', '--set-upstream', '--mirror', 'veritas/x'], ['push', '--set-upstream', 'https://evil.example/r.git;x', 'veritas/x'],
    ]) expect(() => ok(...bad), bad.join(' ')).toThrow(GitDeniedError);
  });
  it('allows only listing remotes and reading one address', () => {
    expect(ok('remote')).toContain('remote');
    expect(ok('remote', 'get-url', 'origin')).toContain('get-url');
    expect(() => ok('remote', 'add', 'x', 'url')).toThrow(GitDeniedError);
    expect(() => ok('remote', 'set-url', 'origin', 'x')).toThrow(GitDeniedError);
  });
});

describe('hardened git: diffs never run a program named by the repository', () => {
  it('adds the protective flags to diff, show and log', () => {
    for (const sub of ['diff', 'show', 'log']) {
      const argv = gitArgv('/tmp/r', [sub, '--cached']);
      const at = argv.indexOf(sub);
      expect(argv.slice(at, at + 3)).toEqual([sub, '--no-ext-diff', '--no-textconv']);
    }
    expect(gitArgv('/tmp/r', ['status'])).not.toContain('--no-ext-diff');
  });

  it('produces a real diff while ignoring a malicious external diff driver and text converter', async () => {
    const repo = makeRepo({ 'a.txt': 'one\n', '.gitattributes': '*.txt diff=evil\n' });
    const marker = join(repo, 'PWNED');
    const script = join(repo, '..', `evil-${Date.now()}.sh`);
    writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    sh(repo, 'config', 'diff.external', script);
    sh(repo, 'config', 'diff.evil.textconv', script);
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    sh(repo, 'add', '-A');
    const { git } = await import('../../src/security/safe-git.js');
    const r = await git(repo, ['diff', '--cached'], { readOnly: true });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('+two');
    expect(existsSync(marker)).toBe(false);
    rmSync(script, { force: true });
  });
});
