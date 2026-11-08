import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { runProcess, type RunProcessOptions, type RunProcessResult } from '../shared/process.js';

export class ExecDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecDeniedError';
  }
}

export interface SafeExecutorOptions {
  /** Absolute paths of the only programs that may be started. Matched exactly. */
  allowedCommands: readonly string[];
}

const MAX_ARGS = 256;
const MAX_ARG_LENGTH = 128 * 1024;

/**
 * Runs only pre-approved programs, identified by their exact absolute path.
 * A program with the same file name in another directory is rejected.
 * Arguments are passed as a vector; no shell is ever involved.
 */
export class SafeExecutor {
  private readonly allowed: ReadonlySet<string>;

  constructor(options: SafeExecutorOptions) {
    const set = new Set<string>();
    for (const command of options.allowedCommands) {
      if (!isAbsolute(command)) throw new Error(`Allowed command must be an absolute path: ${command}`);
      set.add(normalize(command));
    }
    this.allowed = set;
  }

  isAllowed(command: string): boolean {
    return isAbsolute(command) && this.allowed.has(normalize(command));
  }

  run(command: string, args: readonly string[], options: RunProcessOptions = {}): Promise<RunProcessResult> {
    if (!this.isAllowed(command)) throw new ExecDeniedError(`Program is not allowed: ${command}`);
    assertSafeArgs(args);
    return runProcess(normalize(command), args, options);
  }
}

export function assertSafeArgs(args: readonly string[]): void {
  if (args.length > MAX_ARGS) throw new ExecDeniedError('Too many arguments');
  for (const arg of args) {
    if (typeof arg !== 'string') throw new ExecDeniedError('Arguments must be strings');
    if (arg.includes('\0')) throw new ExecDeniedError('Argument contains a NUL byte');
    if (arg.length > MAX_ARG_LENGTH) throw new ExecDeniedError('Argument is too long');
  }
}

/**
 * Find an executable by searching an explicit list of directories (no shell,
 * no implicit PATH). Returns the absolute path or `undefined`.
 */
export function resolveExecutable(name: string, searchDirs: readonly string[]): string | undefined {
  if (name.includes('/') || name.includes('\\') || name.includes('\0') || name === '') return undefined;
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of searchDirs) {
    if (!isAbsolute(dir)) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, name + suffix);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch { /* try next */ }
    }
  }
  return undefined;
}

/** Split a PATH-style string into its directories. */
export function pathDirs(pathValue: string | undefined = process.env.PATH): string[] {
  return (pathValue ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
}
