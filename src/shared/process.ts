import { spawn } from 'node:child_process';

export interface RunProcessOptions {
  cwd?: string;
  /** Environment used exactly as given. Nothing is inherited implicitly. */
  env?: NodeJS.ProcessEnv;
  /** Text written to the child's stdin, then closed. */
  input?: string;
  /** Time limit before the process group is terminated. Default 120 s. */
  timeoutMs?: number;
  /** Delay between SIGTERM and SIGKILL. Default 5 s. */
  killGraceMs?: number;
  /** Cap for each of stdout and stderr; the process is killed when exceeded. Default 10 MiB. */
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface RunProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  /** True when output exceeded the cap and the process was killed. */
  truncated: boolean;
  durationMs: number;
  /** Set when the process could not be started at all (for example ENOENT). */
  spawnError?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024;

/**
 * Run a program without a shell. The command and every argument are passed as
 * an argument vector, so nothing is ever interpreted by a shell.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions = {},
): Promise<RunProcessResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const started = Date.now();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? {},
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false,
        truncated: false, durationMs: Date.now() - started,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let aborted = false;
    let truncated = false;
    let spawnError: string | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let finished = false;

    const killTree = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try { child.kill(sig); } catch { /* already gone */ }
      }
    };

    const terminate = (): void => {
      killTree('SIGTERM');
      killTimer ??= setTimeout(() => killTree('SIGKILL'), killGraceMs);
    };

    const timeoutTimer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    const onAbort = (): void => { aborted = true; terminate(); };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      outBytes += chunk.length;
      if (outBytes > maxOutput) { truncated = true; terminate(); return; }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (truncated) return;
      errBytes += chunk.length;
      if (errBytes > maxOutput) { truncated = true; terminate(); return; }
      err.push(chunk);
    });
    child.stdin.on('error', () => { /* child exited before reading its input */ });
    child.on('error', (e) => { spawnError = e.message; });

    child.on('close', (exitCode, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
      // A process that never started has no meaningful exit code (Node reports a negative errno).
      const neverStarted = child.pid === undefined;
      resolve({
        exitCode: neverStarted ? null : exitCode, signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut, aborted, truncated,
        durationMs: Date.now() - started,
        ...(spawnError ? { spawnError } : {}),
      });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
