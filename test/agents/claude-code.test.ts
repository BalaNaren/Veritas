import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveClaudeLaunchCommand } from '../../src/agents/claude-command.js';
import { ClaudeCodeProvider, buildArgs, parseEnvelope } from '../../src/agents/claude-code.js';
import type { AgentRunRequest } from '../../src/agents/provider.js';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, '..', 'fixtures', 'fake-claude.mjs');
const provider = (opts = {}) => new ClaudeCodeProvider({ binary: FAKE, defaultTimeoutMs: 15_000, ...opts });
const req = (prompt: string, extra: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  prompt, model: 'sonnet', cwd: process.cwd(), tools: [], ...extra,
});

describe('buildArgs', () => {
  it('builds the expected argument vector without the prompt', () => {
    const args = buildArgs(req('secret prompt text', { maxBudgetUsd: 0.5, jsonSchema: { type: 'object' } }));
    expect(args).toContain('-p');
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'json']);
    expect(args).toContain('--no-session-persistence');
    expect(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'dontAsk']);
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(args.join(' ')).not.toContain('secret prompt text');
    expect(args).toContain('0.500000');
    expect(args).toContain('{"type":"object"}');
  });

  it('never enables the bare mode', () => {
    expect(buildArgs(req('x'))).not.toContain('--bare');
  });

  it('joins tools and allowed tools into lists', () => {
    const args = buildArgs(req('x', { tools: ['WebSearch', 'WebFetch'], allowedTools: ['WebSearch'] }));
    expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    expect(args[args.indexOf('--allowed-tools') + 1]).toBe('WebSearch');
  });

  it('rejects values that could be read as options', () => {
    expect(() => buildArgs(req('x', { model: '--dangerously-skip-permissions' }))).toThrow(/Invalid model/);
    expect(() => buildArgs(req('x', { tools: ['--bare'] }))).toThrow(/Invalid tool/);
    expect(() => buildArgs(req('x', { addDirs: ['relative'] }))).toThrow(/Invalid directory/);
    expect(() => buildArgs(req('x', { addDirs: ['-/etc'] }))).toThrow(/Invalid directory/);
  });

  it('rejects relative working directories and bad budgets', () => {
    expect(() => buildArgs(req('x', { cwd: 'rel' }))).toThrow(/absolute/);
    expect(() => buildArgs(req('x', { maxBudgetUsd: 0 }))).toThrow(/positive/);
    expect(() => buildArgs(req('x', { maxBudgetUsd: Number.NaN }))).toThrow(/positive/);
  });
});

describe('parseEnvelope', () => {
  it('parses a plain JSON object', () => {
    expect(parseEnvelope('{"result":"hi"}')?.result).toBe('hi');
  });
  it('tolerates warning lines before the JSON', () => {
    expect(parseEnvelope('warning: something\n{"result":"hi"}\n')?.result).toBe('hi');
  });
  it('rejects empty and non-object output', () => {
    expect(parseEnvelope('')).toBeUndefined();
    expect(parseEnvelope('[1,2]')).toBeUndefined();
    expect(parseEnvelope('nope')).toBeUndefined();
  });
  it('drops prototype-polluting keys', () => {
    const e = parseEnvelope('{"result":"x","__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(e.result).toBe('x');
  });
});

describe('ClaudeCodeProvider.run', () => {
  it('returns text, cost and token counts on success', async () => {
    const r = await provider().run(req('hello world'));
    expect(r.ok).toBe(true);
    expect(r.text).toBe('echo:hello world');
    expect(r.costUsd).toBeCloseTo(0.01);
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(5);
    expect(r.cacheReadTokens).toBe(100);
    expect(r.cacheCreationTokens).toBe(2);
    expect(r.sessionId).toBe('sess-fake');
  });

  it('passes the prompt on stdin, not in the arguments', async () => {
    const r = await provider().run(req('[[fake:argv]] ' + 'x'.repeat(50_000)));
    const info = JSON.parse(r.text);
    expect(info.promptLength).toBeGreaterThan(50_000);
    expect(JSON.stringify(info.args)).not.toContain('xxxxxxxx');
  });

  it('gives the agent only allowlisted environment variables', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    process.env.MY_PRIVATE_TOKEN = 'nope';
    const r = await provider().run(req('[[fake:argv]]'));
    const names: string[] = JSON.parse(r.text).envNames;
    expect(names).not.toContain('ANTHROPIC_API_KEY');
    expect(names).not.toContain('MY_PRIVATE_TOKEN');
    expect(names).toContain('PATH');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MY_PRIVATE_TOKEN;
  });

  it('can pass extra named variables when asked', async () => {
    process.env.MY_EXTRA = 'yes';
    const r = await provider({ extraEnvNames: ['MY_EXTRA'] }).run(req('[[fake:argv]]'));
    expect(JSON.parse(r.text).envNames).toContain('MY_EXTRA');
    delete process.env.MY_EXTRA;
  });

  it('runs in the requested directory', async () => {
    const r = await provider().run(req('[[fake:argv]]', { cwd: '/tmp' }));
    expect(JSON.parse(r.text).cwd).toMatch(/\/tmp$/);
  });

  it('returns structured output when a schema is used', async () => {
    const r = await provider().run(req('[[fake:schema]]', { jsonSchema: { type: 'object' } }));
    expect(r.ok).toBe(true);
    expect(r.json).toEqual({ answer: 'Paris' });
  });

  it('tolerates noise before the JSON envelope', async () => {
    expect((await provider().run(req('[[fake:noisy]]'))).text).toBe('after-noise');
  });

  it('reports an agent error with its message and cost', async () => {
    const r = await provider().run(req('[[fake:error]]'));
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('agent_error');
    expect(r.error?.message).toContain('something went wrong');
    expect(r.costUsd).toBeCloseTo(0.01);
  });

  it('classifies a spending-cap stop as a budget error and keeps the cost', async () => {
    const r = await provider().run(req('[[fake:budget]]'));
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('budget');
    expect(r.costUsd).toBeCloseTo(0.0009);
  });

  it('reports a crash without an envelope as a process error', async () => {
    const r = await provider().run(req('[[fake:crash]]'));
    expect(r.error?.kind).toBe('process');
    expect(r.error?.message).toContain('segfault-ish');
  });

  it('reports unintelligible output as an envelope error', async () => {
    const r = await provider().run(req('[[fake:badjson]]'));
    expect(r.error?.kind).toBe('envelope');
  });

  it('kills a run that exceeds the time limit', async () => {
    const t0 = Date.now();
    const r = await provider().run(req('[[fake:sleep]]', { timeoutMs: 500 }));
    expect(r.error?.kind).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  it('stops a run that floods its output', async () => {
    const r = await provider().run(req('[[fake:flood]]', { timeoutMs: 20_000 }));
    expect(r.error?.kind).toBe('output_too_large');
  });

  it('can be cancelled', async () => {
    const ac = new AbortController();
    const p = provider().run(req('[[fake:sleep]]', { signal: ac.signal, timeoutMs: 20_000 }));
    setTimeout(() => ac.abort(), 200);
    expect((await p).error?.kind).toBe('aborted');
  });

  it('reports a missing runtime as unavailable', async () => {
    const r = await new ClaudeCodeProvider({ binary: '/definitely/not/claude' }).run(req('hi'));
    expect(r.error?.kind).toBe('unavailable');
  });

  it('rejects invalid requests without starting anything', async () => {
    const r = await provider().run(req('hi', { model: '--bare' }));
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Invalid model/);
  });
});

describe('resolveClaudeLaunchCommand', () => {
  it('finds claude on a posix PATH', () => {
    const r = resolveClaudeLaunchCommand({ platform: 'linux', pathValue: '/a:/b', fileExists: (p) => p === '/b/claude' });
    expect(r).toEqual({ command: '/b/claude', argsPrefix: [] });
  });

  it('returns null when it is not installed', () => {
    expect(resolveClaudeLaunchCommand({ platform: 'linux', pathValue: '/a:/b', fileExists: () => false })).toBeNull();
  });

  it('ignores relative PATH entries', () => {
    const r = resolveClaudeLaunchCommand({ platform: 'linux', pathValue: 'bin:/b', fileExists: (p) => p === 'bin/claude' });
    expect(r).toBeNull();
  });

  it('prefers a native .exe on Windows', () => {
    const r = resolveClaudeLaunchCommand({
      platform: 'win32', pathValue: 'C:\\npm', fileExists: (p) => p === 'C:\\npm\\claude.exe' || p === 'C:\\npm\\claude.cmd',
    });
    expect(r?.command).toBe('C:\\npm\\claude.exe');
  });

  it('resolves the package behind a Windows npm shim without using the shim', () => {
    const native = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    const r = resolveClaudeLaunchCommand({
      platform: 'win32', pathValue: 'C:\\npm', fileExists: (p) => p === 'C:\\npm\\claude.cmd' || p === native,
    });
    expect(r).toEqual({ command: native, argsPrefix: [] });
  });

  it('falls back to the JavaScript entry point under node', () => {
    const entry = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
    const r = resolveClaudeLaunchCommand({
      platform: 'win32', nodeExecutable: 'C:\\node.exe', pathValue: 'C:\\npm',
      fileExists: (p) => p === 'C:\\npm\\claude.cmd' || p === entry,
    });
    expect(r).toEqual({ command: 'C:\\node.exe', argsPrefix: [entry] });
  });
});
