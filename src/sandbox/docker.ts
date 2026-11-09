import { randomBytes } from 'node:crypto';
import { SANDBOX_LIMITS, SandboxError, type Sandbox, type SandboxRequest, type SandboxResult } from './types.js';
import { runProcess } from '../shared/process.js';
import { collectOutputs, prepareWorkDir } from './workdir.js';

export interface DockerOptions {
  /** Absolute path of the docker program. */
  docker: string;
  /** Image built from docker/python/Dockerfile. */
  image: string;
  memory?: string;
  cpus?: string;
  pids?: number;
}

/** The `docker run` arguments. Everything that could widen what the code can do is switched off. */
export function dockerArgs(o: DockerOptions, workDir: string, name: string, uid: number, gid: number): string[] {
  return [
    'run', '--rm', '--name', name,
    '--network', 'none',
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', o.memory ?? '1g', '--memory-swap', o.memory ?? '1g',
    '--cpus', o.cpus ?? '1', '--pids-limit', String(o.pids ?? 128),
    '--user', `${uid}:${gid}`,
    '-v', `${workDir}:/work`, '-w', '/work',
    '-e', 'HOME=/work', '-e', 'MPLCONFIGDIR=/work/.mpl', '-e', 'PYTHONDONTWRITEBYTECODE=1',
    o.image, 'python', '-I', '-B', 'run.py',
  ];
}

/** Runs Python in a locked-down container: no network, read-only system, one writable folder, memory/CPU/process limits. */
export class DockerSandbox implements Sandbox {
  readonly backend = 'docker';

  constructor(private readonly o: DockerOptions) {}

  async run(request: SandboxRequest): Promise<SandboxResult> {
    const work = prepareWorkDir(request);
    const started = Date.now();
    const name = `veritas-${randomBytes(6).toString('hex')}`;
    try {
      const timeoutMs = Math.min(request.timeoutMs ?? SANDBOX_LIMITS.defaultTimeoutMs, SANDBOX_LIMITS.maxTimeoutMs);
      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      const res = await runProcess(this.o.docker, dockerArgs(this.o, work.path, name, uid, gid), {
        cwd: work.path, env: { PATH: '/usr/bin:/bin:/usr/local/bin', HOME: work.path },
        timeoutMs, killGraceMs: 1000, maxOutputBytes: SANDBOX_LIMITS.maxOutputBytes, signal: request.signal,
      });
      if (res.spawnError) throw new SandboxError(`Could not start docker: ${res.spawnError}`);
      // Stopping the docker program does not stop the container, so stop it explicitly.
      if (res.timedOut || res.aborted || res.truncated) {
        await runProcess(this.o.docker, ['kill', name], { env: { PATH: '/usr/bin:/bin:/usr/local/bin' }, timeoutMs: 15_000 });
      }
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
