import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitDeniedError, git, gitArgv, gitEnv, gitText } from '../../src/security/safe-git.js';

const repo = '/tmp/some-repo';

describe('gitArgv', () => {
  it('puts hardening overrides before the repository and subcommand', () => {
    const argv = gitArgv(repo, ['status', '--short']);
    expect(argv).toContain('core.fsmonitor=false');
    expect(argv.some((a) => a.startsWith('core.hooksPath='))).toBe(true);
    expect(argv.indexOf('core.fsmonitor=false')).toBeLessThan(argv.indexOf('-C'));
    expect(argv.slice(-2)).toEqual(['status', '--short']);
  });

  it('refuses a leading option so callers cannot inject config', () => {
    expect(() => gitArgv(repo, ['-c', 'core.sshCommand=evil', 'status'])).toThrow(GitDeniedError);
  });

  it('refuses subcommands that are not allowed', () => {
    expect(() => gitArgv(repo, ['push'])).toThrow(GitDeniedError);
    expect(() => gitArgv(repo, ['fetch'])).toThrow(GitDeniedError);
    expect(() => gitArgv(repo, ['clone', 'x'])).toThrow(GitDeniedError);
  });

  it('refuses dangerous arguments', () => {
    expect(() => gitArgv(repo, ['diff', '--ext-diff'])).toThrow(GitDeniedError);
    expect(() => gitArgv(repo, ['log', '--output=/tmp/x'])).toThrow(GitDeniedError);
  });

  it('allows -o for ls-files', () => {
    expect(() => gitArgv(repo, ['ls-files', '-o', '--exclude-standard'])).not.toThrow();
  });

  it('requires an absolute repository path', () => {
    expect(() => gitArgv('relative/path', ['status'])).toThrow(GitDeniedError);
  });
});

describe('gitEnv', () => {
  it('disables prompts and system config and drops unrelated variables', () => {
    process.env.SOME_SECRET_TOKEN = 'abc';
    const env = gitEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.SOME_SECRET_TOKEN).toBeUndefined();
    delete process.env.SOME_SECRET_TOKEN;
  });
});

describe('git (real repository)', () => {
  it('ignores a command-bearing fsmonitor configured inside the repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veritas-git-'));
    const marker = join(dir, 'pwned');
    await git(dir, ['init', '-q']);
    // Repository-local config that would run a program when git refreshes the index.
    await git(dir, ['config', 'core.fsmonitor', `touch ${marker}; echo`]);
    writeFileSync(join(dir, 'a.txt'), 'hi');
    await git(dir, ['status', '--short']);
    const { existsSync } = await import('node:fs');
    expect(existsSync(marker)).toBe(false);
  });

  it('returns trimmed output from gitText', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veritas-git-'));
    await git(dir, ['init', '-q']);
    expect(await gitText(dir, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
  });

  it('throws with the git error message on failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veritas-git-'));
    await expect(gitText(dir, ['rev-parse', '--verify', 'HEAD'])).rejects.toThrow(/rev-parse failed/);
  });
});
