import { devNull } from 'node:os';
import { isAbsolute } from 'node:path';
import { pickEnv } from '../shared/env.js';
import { runProcess, type RunProcessResult } from '../shared/process.js';
import { pathDirs, resolveExecutable } from './safe-exec.js';

/**
 * Git settings that can make git run an arbitrary program are overridden on
 * the command line, where they take precedence over any setting stored inside
 * a repository. Repository hooks are disabled for the same reason.
 */
const HARDENING_CONFIG = [
  'core.fsmonitor=false',
  `core.hooksPath=${devNull}`,
  'core.pager=cat',
  'core.editor=true',
  'diff.external=',
  'protocol.ext.allow=never',
  'credential.helper=',
] as const;

/** Subcommands Veritas may run. Extend deliberately. */
const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'ls-files', 'branch', 'worktree', 'checkout',
  'switch', 'add', 'commit', 'merge', 'apply', 'reset', 'stash', 'config', 'cat-file', 'symbolic-ref', 'init',
]);

// None of the allowed subcommands accept these, so any appearance is suspicious.
const FORBIDDEN_ARG_PREFIXES = ['--upload-pack', '--receive-pack', '--exec', '--ext-diff', '--output'];

const GIT_ENV_NAMES = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot', 'USERPROFILE'];

export interface GitOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string;
  /** Skip optional index locks (use for read-only commands). */
  readOnly?: boolean;
}

export class GitDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitDeniedError';
  }
}

/** Build the full argument vector for a hardened git call. Exposed for tests. */
export function gitArgv(repoRoot: string, args: readonly string[]): string[] {
  if (!isAbsolute(repoRoot) || repoRoot.includes('\0')) throw new GitDeniedError('Repository path must be absolute');
  const [sub, ...rest] = args;
  if (sub === undefined || sub.startsWith('-')) {
    throw new GitDeniedError('The first git argument must be a subcommand');
  }
  if (!ALLOWED_SUBCOMMANDS.has(sub)) throw new GitDeniedError(`git subcommand not allowed: ${sub}`);
  for (const arg of args) {
    if (arg.includes('\0')) throw new GitDeniedError('Argument contains a NUL byte');
  }
  for (const arg of rest) {
    if (FORBIDDEN_ARG_PREFIXES.some((p) => arg.startsWith(p))) {
      throw new GitDeniedError(`git argument not allowed: ${arg}`);
    }
  }
  const config = HARDENING_CONFIG.flatMap((c) => ['-c', c]);
  return [...config, '-C', repoRoot, ...args];
}

export function gitEnv(readOnly = false): Record<string, string> {
  return pickEnv(GIT_ENV_NAMES, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'true',
    GIT_PAGER: 'cat',
    ...(readOnly ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
  });
}

export function findGit(): string | undefined {
  return resolveExecutable('git', pathDirs());
}

/** Run git in `repoRoot` with hardened settings. Always has a timeout. */
export async function git(repoRoot: string, args: readonly string[], options: GitOptions = {}): Promise<RunProcessResult> {
  const bin = findGit();
  if (!bin) throw new GitDeniedError('git was not found on PATH');
  return runProcess(bin, gitArgv(repoRoot, args), {
    env: gitEnv(options.readOnly),
    timeoutMs: options.timeoutMs ?? 60_000,
    maxOutputBytes: options.maxOutputBytes ?? 8 * 1024 * 1024,
    input: options.input,
  });
}

/** Run git and return trimmed stdout; throws with stderr when git fails. */
export async function gitText(repoRoot: string, args: readonly string[], options: GitOptions = {}): Promise<string> {
  const r = await git(repoRoot, args, options);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (${r.exitCode ?? r.signal ?? 'no exit'}): ${r.stderr.trim().slice(0, 500)}`);
  }
  return r.stdout.trim();
}
