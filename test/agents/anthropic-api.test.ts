import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicApiProvider } from '../../src/agents/anthropic-api.js';
import { MODELS, costOf, resolveModel } from '../../src/agents/anthropic-models.js';
import { toApiSchema } from '../../src/agents/api-schema.js';
import { ApiToolbox, globToRegExp } from '../../src/agents/api-tools.js';

type Reply = { status?: number; body: unknown };
let server: Server;
let base = '';
let seen: { headers: Record<string, unknown>; body: any }[] = [];
let script: Reply[] = [];

const usage = (input = 1000, output = 500) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
const msg = (content: unknown[], stop = 'end_turn', u = usage()) => ({ body: { id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason: stop, usage: u } });
const text = (t: string) => ({ type: 'text', text: t });

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(data) });
      const r = script.shift() ?? { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'script empty' } } };
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

const provider = (o = {}) => new AnthropicApiProvider({ apiKey: 'sk-test-key', baseURL: base, ...o });
const req = (extra = {}) => ({ prompt: 'hi', model: 'sonnet', cwd: tmpdir(), tools: [] as string[], ...extra });
const reset = (...r: Reply[]) => { seen = []; script = r; };

describe('prices', () => {
  it('maps aliases to ids and rejects unknown models', () => {
    expect(resolveModel('opus').id).toBe('claude-opus-5-5');
    expect(() => resolveModel('gpt-x')).toThrow(/no known price/);
  });
  it('computes cost, including cache prices and web searches', () => {
    const c = costOf(MODELS['claude-sonnet-5-5']!, { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, server_tool_use: { web_search_requests: 3 } });
    expect(c).toBeCloseTo(2 + 10 + 0.1 + 0.03, 6);
  });
  it('uses the higher Haiku 5.5 tier above 100,000 prompt tokens, cache included', () => {
    const h = MODELS['claude-haiku-5-5']!;
    expect(costOf(h, { input_tokens: 90_000, output_tokens: 0 })).toBeCloseTo(0.009, 6);
    expect(costOf(h, { input_tokens: 50_000, cache_read_input_tokens: 60_000, output_tokens: 0 })).toBeCloseTo(0.025 + 0.003, 6);
  });
});

describe('toApiSchema', () => {
  it('closes objects and drops unsupported keywords but keeps property names', () => {
    const out = toApiSchema({ type: 'object', properties: { minimum: { type: 'integer', minimum: 1 }, list: { type: 'array', maxItems: 3, items: { type: 'object', properties: {} } } }, required: ['minimum'] }) as any;
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.minimum).toEqual({ type: 'integer' });
    expect(out.properties.list.maxItems).toBeUndefined();
    expect(out.properties.list.items.additionalProperties).toBe(false);
  });
});

describe('provider', () => {
  it('sends the key to the explicit base URL and returns text and cost', async () => {
    reset(msg([text('hello')]));
    const r = await provider().run(req());
    expect(r.ok).toBe(true);
    expect(r.text).toBe('hello');
    expect(r.costUsd).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6, 8);
    expect(String(seen[0]!.headers.authorization)).toContain('sk-test-key');
    expect(seen[0]!.body.model).toBe('claude-sonnet-5-5');
  });

  it('requests structured output and parses it', async () => {
    reset(msg([text('{"a":1}')]));
    const r = await provider().run(req({ jsonSchema: { type: 'object', properties: { a: { type: 'integer', minimum: 0 } } } }));
    expect(r.json).toEqual({ a: 1 });
    expect(seen[0]!.body.output_config.format.type).toBe('json_schema');
    expect(seen[0]!.body.output_config.format.schema.additionalProperties).toBe(false);
  });

  it('falls back to asking in words when the schema is rejected', async () => {
    reset({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'schema too complex' } } }, msg([text('```json\n{"a":2}\n```')]));
    const r = await provider().run(req({ jsonSchema: { type: 'object' } }));
    expect(r.json).toEqual({ a: 2 });
    expect(seen[1]!.body.output_config).toBeUndefined();
    expect(seen[1]!.body.system).toContain('JSON Schema');
  });

  it('reports invalid JSON as an envelope error', async () => {
    reset(msg([text('not json')]));
    const r = await provider().run(req({ jsonSchema: { type: 'object' } }));
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('envelope');
  });

  it('adds web tools as server tools and continues after pause_turn', async () => {
    reset(msg([{ type: 'server_tool_use', id: 's', name: 'web_search', input: {} }], 'pause_turn'), msg([text('done')], 'end_turn', { ...usage(), server_tool_use: { web_search_requests: 2 } } as never));
    const r = await provider().run(req({ tools: ['WebSearch', 'WebFetch'] }));
    expect(r.text).toBe('done');
    expect(seen[0]!.body.tools.map((t: any) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209']);
    expect(seen[1]!.body.messages).toHaveLength(2);
    expect(r.costUsd).toBeCloseTo(2 * (1000 * 2 + 500 * 10) / 1e6 + 0.02, 8);
    expect(r.numTurns).toBe(2);
  });

  it('runs file tools inside the working folder and returns the results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veritas-api-'));
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
    reset(msg([{ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.txt' } }], 'tool_use'), msg([text('ok')]));
    const r = await provider().run(req({ cwd: dir, tools: ['Read'] }));
    expect(r.ok).toBe(true);
    const sent = seen[1]!.body.messages[2].content[0];
    expect(sent.tool_use_id).toBe('t1');
    expect(sent.content).toContain('two');
  });

  it('refuses tools it cannot confine', async () => {
    reset();
    const r = await provider().run(req({ tools: ['Bash'] }));
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('unavailable');
    expect(seen).toHaveLength(0);
  });

  it('stops when the spending limit is reached', async () => {
    reset(msg([{ type: 'tool_use', id: 't', name: 'Glob', input: { pattern: '*' } }], 'tool_use', usage(1_000_000, 0)), msg([text('late')]));
    const r = await provider().run(req({ tools: ['Glob'], maxBudgetUsd: 0.5 }));
    expect(r.error?.kind).toBe('budget');
    expect(seen).toHaveLength(1);
  });

  it('maps refusal, truncation, bad key and abort', async () => {
    reset(msg([text('')], 'refusal'));
    expect((await provider().run(req())).error?.message).toMatch(/declined/);
    reset(msg([text('x')], 'max_tokens'));
    expect((await provider().run(req())).error?.kind).toBe('output_too_large');
    reset({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'bad key sk-test-key' } } });
    const bad = await provider().run(req());
    expect(bad.error?.kind).toBe('unavailable');
    expect(JSON.stringify(bad)).not.toContain('sk-test-key');
    const ac = new AbortController(); ac.abort();
    reset(msg([text('x')]));
    expect((await provider().run(req({ signal: ac.signal }))).error?.kind).toBe('aborted');
  });

  it('does not leak the key from error messages', async () => {
    reset({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'oops sk-test-key' } } });
    const r = await provider().run(req());
    expect(r.error?.message).not.toContain('sk-test-key');
  });
});

describe('ApiToolbox confinement', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'veritas-box-'));
    const cwd = join(root, 'work'); mkdirSync(cwd);
    writeFileSync(join(root, 'secret.txt'), 'top secret');
    writeFileSync(join(cwd, 'ok.txt'), 'fine\nneedle here');
    writeFileSync(join(cwd, 'key.pem'), 'PRIVATE');
    symlinkSync(join(root, 'secret.txt'), join(cwd, 'link.txt'));
    return { root, cwd, box: new ApiToolbox(cwd) };
  };
  it('reads, greps and globs inside the folder', async () => {
    const { box } = setup();
    expect((await box.run('Read', { path: 'ok.txt' })).content).toContain('needle');
    expect((await box.run('Grep', { pattern: 'needle' })).content).toContain('ok.txt:2:needle here');
    expect((await box.run('Glob', { pattern: '*.txt' })).content).toContain('ok.txt');
  });
  it('refuses paths outside, traversal, symlink escapes and sensitive files', async () => {
    const { root, box } = setup();
    for (const p of [join(root, 'secret.txt'), '../secret.txt', 'link.txt', 'key.pem']) {
      const r = await box.run('Read', { path: p });
      expect(r.isError, p).toBe(true);
      expect(r.content).not.toContain('top secret');
    }
    expect((await box.run('Write', { path: '../evil.txt', content: 'x' })).isError).toBe(true);
    expect((await box.run('Grep', { pattern: 'secret', path: root })).isError).toBe(true);
  });
  it('writes and edits only inside, and edit needs a unique match', async () => {
    const { cwd, box } = setup();
    expect((await box.run('Write', { path: 'sub/new.txt', content: 'a b a' })).isError).toBe(false);
    expect(readFileSync(join(cwd, 'sub/new.txt'), 'utf8')).toBe('a b a');
    expect((await box.run('Edit', { path: 'sub/new.txt', old_string: 'a', new_string: 'z' })).isError).toBe(true);
    expect((await box.run('Edit', { path: 'sub/new.txt', old_string: 'b', new_string: 'c' })).isError).toBe(false);
  });
  it('disabled tools are not usable', async () => {
    const { cwd } = setup();
    expect((await new ApiToolbox(cwd, [], new Set(['Read'])).run('Write', { path: 'x', content: 'y' })).isError).toBe(true);
  });
  it('glob patterns', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/b.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('a/b.ts')).toBe(false);
  });
});
