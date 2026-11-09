import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string; version: string; bin: Record<string, string>; engines: { node: string }; files: string[]; dependencies: Record<string, string>;
  devDependencies: Record<string, string>; scripts: Record<string, string>;
};
const installer = readFileSync(join(root, 'scripts/install.sh'), 'utf8');
const run = (env: Record<string, string>, ...args: string[]) =>
  spawnSync('sh', [join(root, 'scripts/install.sh'), ...args], { env: { PATH: process.env.PATH!, ...env }, encoding: 'utf8' });

describe('package', () => {
  it('has a command called veritas that points at a real, executable file', () => {
    expect(pkg.bin).toEqual({ veritas: 'bin/veritas.js' });
    const file = join(root, pkg.bin.veritas!);
    expect(readFileSync(file, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o111).not.toBe(0);
  });

  it('pins every dependency to an exact version', () => {
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('builds before it is packed and tests before it is published', () => {
    expect(pkg.scripts.prepack).toContain('build');
    expect(pkg.scripts.prepublishOnly).toContain('test');
  });

  it('would publish only the program, its Dockerfile, the licence and the readme', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
    const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    expect(files).toEqual(expect.arrayContaining(['bin/veritas.js', 'package.json', 'LICENSE', 'README.md', 'docker/python/Dockerfile', 'dist/cli/main.js']));
    const unexpected = files.filter((f) => !/^(dist\/|bin\/|docker\/|LICENSE$|README\.md$|package\.json$)/.test(f));
    expect(unexpected).toEqual([]);
    expect(files.some((f) => /\.(test|spec)\./.test(f) || f.includes('node_modules') || f.includes('.env'))).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('install.sh', () => {
  it('installs exactly the version in package.json, from the package name in package.json, never "latest"', () => {
    expect(installer).toContain(`PACKAGE="${pkg.name}"`);
    expect(installer).toContain(`VERSION="${pkg.version}"`);
    expect(installer).not.toMatch(/@latest|:latest/);
    const r = run({}, '--dry-run');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Would run: npm install -g ${pkg.name}@${pkg.version}`);
    expect(r.stdout).toContain('nothing was installed');
  });

  it('asks for the same Node version as the package does', () => {
    const [major, minor] = pkg.engines.node.replace(/^>=/, '').split('.').map(Number);
    expect(installer).toContain(`MIN_MAJOR=${major}`);
    expect(installer).toContain(`MIN_MINOR=${minor}`);
  });

  it('refuses a Node that is too old and accepts the first one that is new enough', () => {
    const old = run({ VERITAS_INSTALL_FAKE_NODE: 'v22.12.9' }, '--dry-run');
    expect(old.status).toBe(1);
    expect(old.stderr).toContain('too old');
    expect(run({ VERITAS_INSTALL_FAKE_NODE: 'v20.0.0' }, '--dry-run').status).toBe(1);
    expect(run({ VERITAS_INSTALL_FAKE_NODE: 'v22.13.0' }, '--dry-run').status).toBe(0);
    expect(run({ VERITAS_INSTALL_FAKE_NODE: 'v24.1.0' }, '--dry-run').status).toBe(0);
    expect(run({ VERITAS_INSTALL_FAKE_NODE: 'banana' }, '--dry-run').status).toBe(1);
  });

  it('rejects unknown options and changes no shell settings', () => {
    expect(run({}, '--nonsense').status).toBe(2);
    expect(installer).not.toMatch(/\.bashrc|\.zshrc|\.profile|sudo|curl|wget|eval /);
  });
});
