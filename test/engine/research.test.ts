import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AgentRunRequest, AgentRunResult, ModelProvider } from '../../src/agents/provider.js';
import { defaultConfig } from '../../src/config.js';
import { Engine, type Approver } from '../../src/engine/engine.js';
import { Store } from '../../src/storage/store.js';
import { isBlockedIp } from '../../src/tools/net-guard.js';
import { createFetcher } from '../../src/tools/web-fetch.js';

let server: Server;
let port = 0;
const PAGE = '<html><head><title>Moon facts</title><meta property="article:published_time" content="2026-01-01"></head><body><main><p>The Moon orbits Earth at an average distance of 384,400 km. It completes one orbit in 27.3 days.</p></main></body></html>';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/moon') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
    res.writeHead(404); res.end('no');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

const homes: string[] = [];
afterEach(() => { while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true }); });

const url = (p: string): string => `http://moon.test:${port}${p}`;
const ok = (over: Partial<AgentRunResult>): AgentRunResult => ({
  ok: true, text: '', costUsd: 0.01, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 1, numTurns: 1, ...over,
});

interface Behaviour { findings?: (key: string) => unknown[]; writer?: string; onRequest?: (r: AgentRunRequest, kind: string) => void; checkerVerdict?: string }

function provider(b: Behaviour = {}): ModelProvider & { kinds: string[] } {
  const kinds: string[] = [];
  return {
    id: 'claude-code', kinds,
    async run(r) {
      const schema = r.jsonSchema ? JSON.stringify(r.jsonSchema) : '';
      const kind = schema.includes('"subtasks"') ? 'plan' : schema.includes('"findings"') ? 'research' : schema.includes('"verdict"') ? 'checker' : 'writer';
      kinds.push(kind);
      b.onRequest?.(r, kind);
      if (kind === 'plan') {
        return ok({ json: { assumptions: [], subtasks: ['q1', 'q2'].map((k) => ({ key: k, title: `Question ${k}`, kind: 'research', instructions: `Find out about ${k}`, dependsOn: [] })) }, costUsd: 0.05 });
      }
      if (kind === 'research') {
        const key = r.prompt.includes('about q1') ? 'q1' : 'q2';
        const findings = b.findings?.(key) ?? [{ claim: 'The Moon is about 384,400 km from Earth.', type: 'number', url: url('/moon'), title: 'Moon', quote: 'average distance of 384,400 km', important: false }];
        return ok({ json: { findings, notes: '' }, costUsd: 0.1 });
      }
      if (kind === 'checker') return ok({ json: { verdict: b.checkerVerdict ?? 'supported', reason: 'The passage says so.', against: [] }, costUsd: 0.005 });
      return ok({ text: b.writer ?? 'The Moon is about 384,400 km from Earth [c1]. It orbits in 27.3 days [c2].\n\nAnalysis: that is a remarkably steady neighbour.', costUsd: 0.2 });
    },
  };
}

function setup(p: ModelProvider, budget = 5) {
  const home = mkdtempSync(join(tmpdir(), 'veritas-res-'));
  homes.push(home);
  const store = Store.open(':memory:');
  const config = { ...defaultConfig(home), maxConcurrent: 2 };
  const fetcher = createFetcher({ resolver: async () => ['127.0.0.1'], isBlockedIp: (ip) => ip !== '127.0.0.1' && isBlockedIp(ip), allowedPorts: new Set([port]) });
  const engine = new Engine({ store, provider: p, config, fetcher, retryDelayMs: 0 });
  return { engine, store, task: engine.createTask('How far away is the Moon?', { budgetUsd: budget }) };
}
const yes: Approver = async () => 'approved';

describe('research pipeline', () => {
  it('plans research tasks, fetches and verifies the cited page, and writes a cited report', async () => {
    const p = provider({ findings: (k) => [k === 'q1'
      ? { claim: 'The Moon is about 384,400 km from Earth.', type: 'number', url: url('/moon'), title: 'Moon', quote: 'average distance of 384,400 km', important: false }
      : { claim: 'The Moon orbits Earth in 27.3 days.', type: 'number', url: url('/moon'), title: 'Moon', quote: 'completes one orbit in 27.3 days', important: false }] });
    const { engine, store, task } = setup(p);
    const r = await engine.execute(task.id, { approver: yes });
    expect(r.task.status).toBe('done');
    expect(r.task.type).toBe('research');
    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).toContain('The Moon is about 384,400 km from Earth [1]. It orbits in 27.3 days [2].');
    expect(md).toContain(`1. Moon facts — ${url('/moon')}`);
    expect(md).toContain('> average distance of 384,400 km');
    expect(md).toContain('- ✓ Confirmed: 2');
    expect(md).toContain('◇ Analysis sentences: 1');
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM claims WHERE status = 'confirmed'").get()).toMatchObject({ n: 2 });
    expect(p.kinds.filter((k) => k === 'writer')).toHaveLength(1);
    expect(r.task.spentUsd).toBeCloseTo(0.05 + 0.2 + 2 * 0.005 * 1 + 0.2, 1);
  });

  it('keeps an agent\'s invented quote and unfetchable source out of the report', async () => {
    const p = provider({
      findings: (k) => (k === 'q1'
        ? [{ claim: 'The Moon is about 384,400 km from Earth.', type: 'number', url: url('/moon'), title: 'Moon', quote: 'average distance of 384,400 km', important: false }]
        : [
            { claim: 'The Moon is made of green cheese.', type: 'fact', url: url('/moon'), title: 'Moon', quote: 'The Moon is composed entirely of green cheese', important: true },
            { claim: 'The Moon has a secret base.', type: 'fact', url: url('/never-fetched'), title: 'Secret', quote: 'There is a secret base on the far side of it', important: false },
          ]),
      writer: 'The Moon is about 384,400 km from Earth [c1].',
    });
    const { engine, store, task } = setup(p);
    const r = await engine.execute(task.id, { approver: yes });
    expect(r.task.status).toBe('done');
    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).not.toMatch(/cheese.*\[\d\]/);
    expect(md).toContain('### Could not be verified');
    expect(md).toContain('**Important:** The Moon is made of green cheese.');
    expect(md).toContain('- ✗ Removed: 2');
    expect(md).toContain('The quote is not in the source');
    expect(md).toContain('The source was not fetched during this task');
    const statuses = store.db.prepare('SELECT status, COUNT(*) AS n FROM claims GROUP BY status').all();
    expect(statuses).toEqual(expect.arrayContaining([{ status: 'confirmed', n: 1 }, { status: 'removed', n: 2 }]));
  });

  it('never shows the writer a removed claim', async () => {
    const seen: string[] = [];
    const p = provider({
      findings: () => [{ claim: 'The Moon is made of green cheese.', type: 'fact', url: url('/moon'), title: 'Moon', quote: 'The Moon is composed entirely of green cheese', important: true }],
      onRequest: (r, kind) => { if (kind === 'writer') seen.push(r.prompt); },
    });
    const { engine, task } = setup(p);
    const r = await engine.execute(task.id, { approver: yes });
    expect(r.task.status).toBe('done');
    expect(seen).toHaveLength(0); // nothing survived, so the writer is not even asked
    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).toContain('No claim survived checking');
    expect(md).toContain('- ✗ Removed: 1');
  });

  it('removes a claim the independent checker rejects', async () => {
    const { engine, task } = setup(provider({ checkerVerdict: 'contradicted', writer: 'x' }));
    const r = await engine.execute(task.id, { approver: yes });
    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).toContain('Contradicted by its source');
    expect(md).toContain('No claim survived checking');
  });

  it('stops checking when the budget is used up, leaves those claims out, and says so', async () => {
    const many = (k: string) => [1, 2, 3, 4].map((n) => ({ claim: `The Moon is about 384,400 km from Earth (${k}${n}).`, type: 'fact', url: url('/moon'), title: 'Moon', quote: 'average distance of 384,400 km', important: false }));
    const { engine, store, task } = setup(provider({ findings: many, writer: 'The Moon is about 384,400 km from Earth [c1].' }), 0.26);
    const r = await engine.execute(task.id, { approver: yes });
    expect(r.task.status).toBe('done');
    const pending = store.db.prepare("SELECT COUNT(*) AS n FROM claims WHERE status = 'pending'").get() as { n: number };
    expect(pending.n).toBeGreaterThan(0);
    const md = readFileSync(r.resultPath!, 'utf8');
    expect(md).toMatch(new RegExp(`Not checked: ${pending.n}`));
    expect(md).toContain('were not checked because the budget was reached');
  });

  it('can be interrupted while checking and resumed without fetching again', async () => {
    const ac = new AbortController();
    const p = provider({ onRequest: (_r, kind) => { if (kind === 'checker') ac.abort(); } });
    const { engine, store, task } = setup(p);
    const first = await engine.execute(task.id, { approver: yes, signal: ac.signal });
    expect(first.task.status).toBe('paused');
    const fetchedBefore = store.listEvents(task.id).filter((e) => e.type === 'source.fetched').length;
    const second = await engine.execute(task.id, { approver: yes });
    expect(second.task.status).toBe('done');
    expect(store.listEvents(task.id).filter((e) => e.type === 'source.fetched')).toHaveLength(fetchedBefore);
    expect(store.listEvents(task.id).filter((e) => e.type === 'evidence.ingested')).toHaveLength(2);
  });
});
