import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tryJsonParse } from '../shared/json.js';
import { runProcess } from '../shared/process.js';
import { SANDBOX_LIMITS, SandboxError, type Sandbox, type SandboxRequest, type SandboxResult } from './types.js';
import { collectOutputs, prepareWorkDir } from './workdir.js';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** Quote a path for a sandbox profile string. */
const q = (p: string): string => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export interface ProfileOptions {
  workDir: string;
  /** Folders the interpreter needs to read (its own install and libraries). */
  readRoots: readonly string[];
  /** The interpreter files that may be started. */
  executables: readonly string[];
}

/**
 * macOS sandbox profile: everything is denied unless listed. No network. Files can be written only inside the
 * private working folder (and not in `input/`). Files can be read only from the interpreter's own install, system
 * libraries and the working folder, so the user's home folder, keys and documents are not visible.
 */
export function buildProfile(o: ProfileOptions): string {
  const read = ['/usr', '/System', '/Library', '/private/var/db', '/dev', ...o.readRoots];
  return [
    '(version 1)',
    '(deny default)',
    '(deny network*)',
    ...o.executables.map((e) => `(allow process-exec (literal ${q(e)}))`),
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow signal (target self))',
    '(allow file-read-metadata)',
    ...read.map((r) => `(allow file-read* (subpath ${q(r)}))`),
    '(allow file-read* (literal "/"))',
    `(allow file-read* (subpath ${q(o.workDir)}))`,
    `(allow file-write* (subpath ${q(o.workDir)}))`,
    `(deny file-write* (subpath ${q(join(o.workDir, 'input'))}))`,
    '(allow file-write* (literal "/dev/null"))',
    '',
  ].join('\n');
}

export interface SandboxExecOptions {
  /** Interpreter to run (the Veritas-managed environment's Python, or any Python for tests). */
  python: string;
}

interface InterpreterLayout { baseDirs: string[]; executables: string[] }

/** Ask the interpreter (outside the sandbox, with fixed arguments) where its real install is. */
async function describeInterpreter(python: string): Promise<InterpreterLayout> {
  const res = await runProcess(python, ['-I', '-c', 'import sys, json; print(json.dumps([sys.base_prefix, sys.prefix, sys.executable]))'], { env: { PATH: '/usr/bin:/bin' }, timeoutMs: 20_000 });
  const info = tryJsonParse<string[]>(res.stdout.trim());
  if (res.exitCode !== 0 || !Array.isArray(info)) throw new SandboxError(`The analysis runtime at ${python} did not start: ${res.stderr.trim() || 'no answer'}`);
  const [basePrefix = '', prefix = '', exe = python] = info;
  const real = realpathSync(python);
  const candidates = [python, real, exe, join(basePrefix, 'Resources/Python.app/Contents/MacOS/Python'), join(basePrefix, 'bin/python3')];
  return {
    baseDirs: [...new Set([prefix, basePrefix, dirname(dirname(real))].filter(Boolean))],
    // On macOS the system python3 is a launcher that starts the real program; both must be startable.
    executables: [...new Set(candidates.filter((c) => existsSync(c)).map((c) => realpathSync(c)).concat(python))],
  };
}

/** Runs Python under macOS `sandbox-exec`. */
export class SandboxExecSandbox implements Sandbox {
  readonly backend = 'sandbox-exec';

  constructor(private readonly o: SandboxExecOptions) {}

  static available(): boolean {
    return process.platform === 'darwin' && existsSync(SANDBOX_EXEC);
  }

  async run(request: SandboxRequest): Promise<SandboxResult> {
    if (!SandboxExecSandbox.available()) throw new SandboxError('sandbox-exec is not available on this system.');
    if (!existsSync(this.o.python)) throw new SandboxError(`The analysis runtime was not found at ${this.o.python}.`);
    const layout = await describeInterpreter(this.o.python);
    const work = prepareWorkDir(request);
    const started = Date.now();
    try {
      const profile = buildProfile({ workDir: work.path, readRoots: layout.baseDirs, executables: layout.executables });
      const profilePath = join(work.path, '.profile.sb');
      writeFileSync(profilePath, profile, { mode: 0o600 });
      const timeoutMs = Math.min(request.timeoutMs ?? SANDBOX_LIMITS.defaultTimeoutMs, SANDBOX_LIMITS.maxTimeoutMs);
      const res = await runProcess(SANDBOX_EXEC, ['-f', profilePath, this.o.python, '-I', '-B', 'run.py'], {
        cwd: work.path,
        // Nothing from the user's environment: no keys, no proxies, no home folder.
        env: { PATH: '/usr/bin:/bin', HOME: work.path, TMPDIR: work.path, MPLCONFIGDIR: join(work.path, '.mpl'), PYTHONDONTWRITEBYTECODE: '1', LANG: 'en_US.UTF-8' },
        timeoutMs, killGraceMs: 1000, maxOutputBytes: SANDBOX_LIMITS.maxOutputBytes, signal: request.signal,
      });
      if (res.spawnError) throw new SandboxError(`Could not start the sandbox: ${res.spawnError}`);
      return {
        ok: res.exitCode === 0 && !res.timedOut && !res.aborted,
        exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, timedOut: res.timedOut, truncated: res.truncated,
        outputs: collectOutputs(work.path, request.outputDir), durationMs: Date.now() - started, backend: this.backend,
      };
    } finally {
      work.cleanup();
    }
  }
}
