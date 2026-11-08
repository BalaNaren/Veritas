import { describe, expect, it } from 'vitest';
import { runProcess } from '../../src/shared/process.js';
import { pickEnv } from '../../src/shared/env.js';

const node = process.execPath;

describe('runProcess', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const r = await runProcess(node, ['-e', 'console.log("out"); console.error("err"); process.exit(3)']);
    expect(r.stdout.trim()).toBe('out');
    expect(r.stderr.trim()).toBe('err');
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it('feeds input to stdin', async () => {
    const r = await runProcess(node, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hello stdin' });
    expect(r.stdout).toBe('hello stdin');
  });

  it('does not inherit the parent environment', async () => {
    process.env.VERITAS_TEST_SECRET = 'leak';
    const r = await runProcess(node, ['-e', 'console.log(process.env.VERITAS_TEST_SECRET ?? "unset")'], { env: {} });
    expect(r.stdout.trim()).toBe('unset');
    delete process.env.VERITAS_TEST_SECRET;
  });

  it('passes arguments without shell interpretation', async () => {
    const r = await runProcess(node, ['-e', 'console.log(process.argv[1])', '$(echo injected); `id`']);
    expect(r.stdout.trim()).toBe('$(echo injected); `id`');
  });

  it('kills the whole process group on timeout', async () => {
    const script = 'const {spawn}=require("child_process"); spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); setInterval(()=>{},1000)';
    const r = await runProcess(node, ['-e', script], { timeoutMs: 400, killGraceMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.signal === 'SIGTERM' || r.signal === 'SIGKILL').toBe(true);
    expect(r.durationMs).toBeLessThan(5000);
  });

  it('kills a process that exceeds the output cap', async () => {
    const r = await runProcess(node, ['-e', 'for(;;) process.stdout.write("x".repeat(4096))'], { maxOutputBytes: 20_000 });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(20_000);
  });

  it('can be aborted with a signal', async () => {
    const ac = new AbortController();
    const p = runProcess(node, ['-e', 'setInterval(()=>{},1000)'], { signal: ac.signal, killGraceMs: 200 });
    setTimeout(() => ac.abort(), 150);
    const r = await p;
    expect(r.aborted).toBe(true);
  });

  it('reports a missing program as a spawn error', async () => {
    const r = await runProcess('/definitely/not/here', []);
    expect(r.spawnError).toBeTruthy();
    expect(r.exitCode).toBeNull();
  });
});

describe('pickEnv', () => {
  it('keeps only named variables and adds extras', () => {
    const env = pickEnv(['A', 'B'], { C: '3' }, { A: '1', B: '2', SECRET: 'x' });
    expect(env).toEqual({ A: '1', B: '2', C: '3' });
  });
});
