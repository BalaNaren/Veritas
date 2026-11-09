import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../shared/process.js';
import { DockerSandbox } from './docker.js';
import { runtimeReady, venvPython } from './python.js';
import { SandboxExecSandbox } from './sandbox-exec.js';
import { SandboxError, type Sandbox } from './types.js';

export const DOCKER_IMAGE = 'veritas-python:1';

function findDocker(): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter((d) => d && isAbsolute(d))) {
    const candidate = join(dir, 'docker');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface SandboxChoice {
  sandbox?: Sandbox;
  /** Why no sandbox is available, in words for the user. */
  problem?: string;
}

/**
 * Pick the strongest sandbox this machine can run. If there is none, analysis code is not run at all:
 * there is no fallback that runs it without a sandbox.
 */
export async function chooseSandbox(home: string): Promise<SandboxChoice> {
  if (SandboxExecSandbox.available()) {
    if (await runtimeReady(home)) return { sandbox: new SandboxExecSandbox({ python: venvPython(home) }) };
    return { problem: 'The analysis environment is not set up. Run `veritas setup` once (it installs pinned copies of pandas and matplotlib into a private folder).' };
  }
  const docker = findDocker();
  if (docker) {
    const image = await runProcess(docker, ['image', 'inspect', DOCKER_IMAGE], { env: { PATH: '/usr/bin:/bin:/usr/local/bin' }, timeoutMs: 30_000 });
    if (image.exitCode === 0) return { sandbox: new DockerSandbox({ docker, image: DOCKER_IMAGE }) };
    return { problem: `Docker is installed but the analysis image is missing. Run \`veritas setup\` to build it from docker/python/Dockerfile.` };
  }
  return { problem: 'No sandbox is available. Data analysis needs macOS (built-in sandbox) or Docker. Veritas never runs analysis code without a sandbox.' };
}

/** Build the analysis image from the Dockerfile that ships with Veritas. */
export async function buildImage(onStep?: (message: string) => void): Promise<void> {
  const docker = findDocker();
  if (!docker) throw new SandboxError('Neither macOS nor Docker is available, so there is no safe place to run analysis code.');
  const context = fileURLToPath(new URL('../../docker/python', import.meta.url));
  onStep?.(`Building the analysis image ${DOCKER_IMAGE} (needs the internet)`);
  const res = await runProcess(docker, ['build', '--pull=false', '-t', DOCKER_IMAGE, context], { env: { PATH: '/usr/bin:/bin:/usr/local/bin' }, timeoutMs: 900_000 });
  if (res.exitCode !== 0) throw new SandboxError(`Building the image failed: ${res.stderr.trim().split('\n').slice(-3).join(' ')}`);
}

export function requireSandbox(choice: SandboxChoice): Sandbox {
  if (!choice.sandbox) throw new SandboxError(choice.problem ?? 'No sandbox is available.');
  return choice.sandbox;
}

export { DockerSandbox, SandboxExecSandbox };
export * from './types.js';
