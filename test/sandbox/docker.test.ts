import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DockerSandbox, dockerArgs } from '../../src/sandbox/docker.js';
import { PINNED_PACKAGES } from '../../src/sandbox/python.js';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_JS = join(here, '..', 'fixtures', 'fake-docker.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'veritas-dk-'));
const KILL_LOG = join(scratch, 'kills.log');
// A real docker is a native program; this wrapper lets the sandbox start the fake with its restricted PATH.
const FAKE = join(scratch, 'docker');
writeFileSync(FAKE, `#!/bin/sh\nFAKE_KILL_LOG=${KILL_LOG} exec "${process.execPath}" "${FAKE_JS}" "$@"\n`);
chmodSync(FAKE, 0o755);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('dockerArgs', () => {
  const args = dockerArgs({ docker: '/usr/bin/docker', image: 'veritas-python:1' }, '/tmp/work', 'veritas-abc', 501, 20);
  const pair = (flag: string): string | undefined => args[args.indexOf(flag) + 1];

  it('switches off everything that could widen what the code can do', () => {
    expect(pair('--network')).toBe('none');
    expect(args).toContain('--read-only');
    expect(pair('--cap-drop')).toBe('ALL');
    expect(pair('--security-opt')).toBe('no-new-privileges');
    expect(pair('--user')).toBe('501:20');
    expect(pair('--memory')).toBe('1g');
    expect(pair('--memory-swap')).toBe('1g');
    expect(pair('--pids-limit')).toBe('128');
    expect(pair('--cpus')).toBe('1');
    expect(pair('--tmpfs')).toContain('noexec');
  });
  it('mounts only the private work folder and never the host system, the home folder or the docker socket', () => {
    const mounts = args.filter((_, i) => args[i - 1] === '-v');
    expect(mounts).toEqual(['/tmp/work:/work']);
    expect(args.join(' ')).not.toMatch(/docker\.sock|--privileged|--network host|--pid[ =]|--ipc/);
  });
  it('runs the image with a fixed command, with no shell', () => {
    expect(args.slice(-5)).toEqual(['veritas-python:1', 'python', '-I', '-B', 'run.py']);
  });
});

describe('Dockerfile', () => {
  const file = readFileSync(join(here, '..', '..', 'docker', 'python', 'Dockerfile'), 'utf8');
  it('pins the base image by digest and the same libraries as the local environment', () => {
    expect(file).toMatch(/^FROM python:[\w.-]+@sha256:[0-9a-f]{64}$/m);
    for (const pkg of PINNED_PACKAGES) expect(file).toContain(pkg);
    expect(file).toContain('USER 10001');
  });
});

describe('DockerSandbox (with a fake docker program)', () => {
  const box = new DockerSandbox({ docker: FAKE, image: 'veritas-python:1' });
  const outputDir = (): string => join(scratch, `o-${Math.random().toString(36).slice(2)}`);

  it('runs through docker with the hardened arguments and collects output files', async () => {
    const r = await box.run({ code: 'print("x")', outputDir: outputDir() });
    expect(r).toMatchObject({ ok: true, stdout: 'ran in fake container\n', backend: 'docker' });
    const argv = JSON.parse(readFileSync(r.outputs.find((o) => o.name === 'argv.json')!.path, 'utf8')) as string[];
    expect(argv).toContain('--network');
    expect(argv[argv.indexOf('--network') + 1]).toBe('none');
  });

  it('stops the container itself when the code runs too long', async () => {
    const r = await box.run({ code: '# SLEEP', outputDir: outputDir(), timeoutMs: 800 });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    const killed = readFileSync(KILL_LOG, 'utf8').trim().split('\n');
    expect(killed).toHaveLength(1);
    expect(killed[0]).toMatch(/^veritas-[0-9a-f]{12}$/);
  });

  it('reports a missing docker program clearly', async () => {
    await expect(new DockerSandbox({ docker: '/nonexistent/docker', image: 'x' }).run({ code: 'print(1)', outputDir: outputDir() })).rejects.toThrow(/Could not start docker/);
  });
});
