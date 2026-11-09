import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApprovedCommands, MAX_OUTPUT_KEPT, runProjectCommand, TestRunStore } from '../../src/coding/test-runs.js';
import { Store } from '../../src/storage/store.js';
import { BUGGY_PROJECT } from './helpers.js';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'veritas-tr-'));
  for (const [n, c] of Object.entries(BUGGY_PROJECT)) writeFileSync(join(dir, n), c);
  writeFileSync(join(dir, 'env.js'), 'console.log(JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, token: process.env.GITHUB_TOKEN ?? null, secret: process.env.MY_SECRET ?? null, ci: process.env.CI }));\n');
  writeFileSync(join(dir, 'sleep.js'), 'setInterval(() => {}, 1000);\n');
  writeFileSync(join(dir, 'flood.js'), 'for (let i = 0; i < 20; i++) process.stdout.write("x".repeat(100000));\nconsole.log("END-OF-OUTPUT");\n');
  writeFileSync(join(dir, 'endless.js'), 'const chunk = "y".repeat(65536);\nconst pump = () => { while (process.stdout.write(chunk)) {} process.stdout.once("drain", pump); };\npump();\n');
  writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\necho from-script\n', { mode: 0o755 });
  mkdirSync(join(dir, 'sub'));
  symlinkSync('/bin/echo', join(dir, 'escape'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('runProjectCommand', () => {
  it('runs the project\'s tests and reports a failure honestly', async () => {
    const r = await runProjectCommand({ cwd: dir, command: 'node --test' });
    expect(r.exitCode).toBe(1);
    expect(r.timedOut).toBe(false);
    expect(r.output).toMatch(/not ok|fail/i);
    expect(r.command).toBe('node --test');
  });

  it('passes nothing secret to the command, and sets CI', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    process.env.GITHUB_TOKEN = 'ghp-should-not-leak';
    process.env.MY_SECRET = 'nope';
    try {
      const r = await runProjectCommand({ cwd: dir, command: 'node env.js' });
      expect(JSON.parse(r.output.trim())).toEqual({ key: null, token: null, secret: null, ci: '1' });
    } finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.GITHUB_TOKEN; delete process.env.MY_SECRET; }
  });

  it('stops a command that runs too long', async () => {
    const t = Date.now();
    const r = await runProjectCommand({ cwd: dir, command: 'node sleep.js', timeoutMs: 800 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t).toBeLessThan(8000);
  });

  it('keeps the end of very long output, which is where failures show', async () => {
    const r = await runProjectCommand({ cwd: dir, command: 'node flood.js' });
    expect(r.output.length).toBeLessThanOrEqual(MAX_OUTPUT_KEPT);
    expect(r.output.trimEnd().endsWith('END-OF-OUTPUT')).toBe(true);
  });

  it('stops a command that prints without end, and does not call that a pass', async () => {
    const r = await runProjectCommand({ cwd: dir, command: 'node endless.js', timeoutMs: 20_000 });
    expect(r.truncated).toBe(true);
    expect(r.exitCode).not.toBe(0);
  });

  it('runs a script that is part of the project, but nothing outside it', async () => {
    expect((await runProjectCommand({ cwd: dir, command: './run.sh' })).output.trim()).toBe('from-script');
    for (const cmd of ['./escape hi', './../x', './missing.sh', '/bin/echo hi', 'sub/../run.sh', 'definitely-not-installed-xyz']) {
      const r = await runProjectCommand({ cwd: dir, command: cmd });
      expect(r.exitCode, cmd).toBeNull();
      expect(r.spawnError, cmd).toBe('not found');
    }
  });

  it('refuses anything that needs a shell', async () => {
    await expect(runProjectCommand({ cwd: dir, command: 'node --test && curl evil.example' })).rejects.toThrow(/needs a shell/);
  });
});

describe('TestRunStore and ApprovedCommands', () => {
  it('records runs and reads them back in order, marking only a clean exit as passed', () => {
    const store = Store.open(':memory:');
    const t = store.createTask({ slug: 't', goal: 'g', type: 'coding', budgetUsd: 1, mode: 'x', cwd: '/' });
    const runs = new TestRunStore(store);
    runs.add({ taskId: t.id, phase: 'baseline', command: 'npm test', exitCode: 1, timedOut: false, durationMs: 5, output: 'fail' });
    runs.add({ taskId: t.id, phase: 'round1', command: 'npm test', exitCode: 0, timedOut: false, durationMs: 6, output: 'ok' });
    runs.add({ taskId: t.id, phase: 'round2', command: 'npm test', exitCode: 0, timedOut: true, durationMs: 9, output: 'slow' });
    expect(runs.list(t.id).map((r) => [r.phase, r.passed])).toEqual([['baseline', false], ['round1', true], ['round2', false]]);
  });
  it('remembers approvals per project and command', () => {
    const store = Store.open(':memory:');
    const a = new ApprovedCommands(store);
    expect(a.isApproved('/repo', 'npm test')).toBe(false);
    a.approve('/repo', 'npm test');
    a.approve('/repo', 'npm test');
    expect(a.isApproved('/repo', 'npm test')).toBe(true);
    expect(a.isApproved('/other', 'npm test')).toBe(false);
    expect(a.isApproved('/repo', 'npm test -- --watch')).toBe(false);
    expect(a.list()).toHaveLength(1);
  });
});
