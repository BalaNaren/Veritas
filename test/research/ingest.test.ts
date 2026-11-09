import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EventLog } from '../../src/engine/event-log.js';
import { EvidenceStore } from '../../src/evidence/evidence-store.js';
import { ingestFindings } from '../../src/research/ingest.js';
import { Store } from '../../src/storage/store.js';
import { isBlockedIp } from '../../src/tools/net-guard.js';
import { createFetcher } from '../../src/tools/web-fetch.js';
import type { Checker } from '../../src/verify/checker.js';
import { verifyClaims } from '../../src/verify/verifier.js';

let server: Server;
let port = 0;
const PAGE = '<html><head><title>Moon facts</title></head><body><main><p>The Moon orbits Earth at an average distance of 384,400 km.</p></main></body></html>';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/short') { res.writeHead(302, { Location: '/moon' }); res.end(); return; }
    if (req.url === '/moon') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
    res.writeHead(404); res.end('no');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

const homes: string[] = [];
afterEach(() => { while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true }); });

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'veritas-ing-'));
  homes.push(home);
  const store = Store.open(':memory:');
  const task = store.createTask({ slug: 't', goal: 'g', type: 'research', budgetUsd: 1, mode: 'x', cwd: '/' });
  const [sub] = store.createSubtasks(task.id, [{ key: 'r1', title: 'r1', kind: 'research', instructions: 'x', dependsOn: [] }]);
  const fetcher = createFetcher({ resolver: async () => ['127.0.0.1'], isBlockedIp: (ip) => ip !== '127.0.0.1' && isBlockedIp(ip), allowedPorts: new Set([port]) });
  const evidence = new EvidenceStore(store, home);
  const events = new EventLog(store);
  const withOutput = (findings: unknown[]) => store.updateSubtask(sub!.id, { output: { findings, notes: '' } });
  return { store, task, evidence, events, fetcher, withOutput };
}
const finding = (over = {}) => ({
  claim: 'The Moon is about 384,400 km from Earth.', type: 'number', url: `http://moon.test:${port}/moon`, title: 'Moon',
  quote: 'average distance of 384,400 km', important: false, ...over,
});
const agreeing: Checker = {
  support: async () => ({ verdict: 'supported', reason: 'ok', costUsd: 0 }),
  crossCheck: async () => ({ verdict: 'agree', reason: 'ok', against: [], costUsd: 0 }),
};

describe('ingestFindings', () => {
  it('fetches the cited page itself, stores a snapshot, records claims, and the claims then verify', async () => {
    const t = setup();
    const sub = t.withOutput([finding()]);
    const r = await ingestFindings({ evidence: t.evidence, fetcher: t.fetcher, events: t.events, taskId: t.task.id, subtask: sub });
    expect(r).toMatchObject({ claims: 1, sourcesFetched: 1, sourcesFailed: 0 });
    const [source] = t.evidence.listSources(t.task.id);
    expect(t.evidence.readSnapshot(source!)).toBe('The Moon orbits Earth at an average distance of 384,400 km.');
    expect(source!.title).toBe('Moon facts');
    const summary = await verifyClaims({ evidence: t.evidence, checker: agreeing, taskId: t.task.id });
    expect(summary).toMatchObject({ confirmed: 1, removed: 0 });
    expect(t.events.history(t.task.id).map((e) => e.type)).toEqual(expect.arrayContaining(['source.fetched', 'evidence.ingested']));
  });

  it('keeps claims whose page cannot be fetched, and verification removes them as unsourced', async () => {
    const t = setup();
    const sub = t.withOutput([finding({ url: `http://moon.test:${port}/gone` }), finding({ claim: 'Second', url: 'http://10.0.0.5/secret' })]);
    const r = await ingestFindings({ evidence: t.evidence, fetcher: t.fetcher, events: t.events, taskId: t.task.id, subtask: sub });
    expect(r).toMatchObject({ claims: 2, sourcesFetched: 0, sourcesFailed: 2 });
    expect(t.events.history(t.task.id).filter((e) => e.type === 'source.failed')).toHaveLength(2);
    const summary = await verifyClaims({ evidence: t.evidence, checker: agreeing, taskId: t.task.id });
    expect(summary).toMatchObject({ confirmed: 0, removed: 2 });
  });

  it('catches an agent that quotes words that are not on the page it cites', async () => {
    const t = setup();
    const sub = t.withOutput([finding({ quote: 'average distance of 400,000 km', claim: 'The Moon is 400,000 km away.' })]);
    await ingestFindings({ evidence: t.evidence, fetcher: t.fetcher, events: t.events, taskId: t.task.id, subtask: sub });
    const summary = await verifyClaims({ evidence: t.evidence, checker: agreeing, taskId: t.task.id });
    expect(summary).toMatchObject({ confirmed: 0, removed: 1 });
    expect(Object.keys(summary.removedReasons)).toEqual(['The quote is not in the source']);
  });

  it('fetches each address once and skips duplicate claims', async () => {
    const t = setup();
    const sub = t.withOutput([finding(), finding(), finding({ claim: 'The Moon orbits Earth.', quote: 'The Moon orbits Earth at an average distance' })]);
    const r = await ingestFindings({ evidence: t.evidence, fetcher: t.fetcher, events: t.events, taskId: t.task.id, subtask: sub });
    expect(r).toMatchObject({ claims: 2, duplicates: 1, sourcesFetched: 1 });
    expect(t.evidence.listSources(t.task.id)).toHaveLength(1);
  });

  it('accepts a claim citing a shortened or redirecting address of a page it did fetch', async () => {
    const t = setup();
    const sub = t.withOutput([finding(), finding({ claim: 'The Moon orbits Earth.', quote: 'The Moon orbits Earth at an average distance', url: `http://moon.test:${port}/short` })]);
    await ingestFindings({ evidence: t.evidence, fetcher: t.fetcher, events: t.events, taskId: t.task.id, subtask: sub });
    expect(t.evidence.listSources(t.task.id)).toHaveLength(1);
    const summary = await verifyClaims({ evidence: t.evidence, checker: agreeing, taskId: t.task.id });
    expect(summary).toMatchObject({ confirmed: 2, removed: 0 });
  });

  it('refuses output that is not valid findings', async () => {
    const t = setup();
    const sub = t.store.updateSubtask(t.store.listSubtasks(t.task.id)[0]!.id, { output: 'plain text' });
    await expect(ingestFindings({ evidence: t.evidence, fetcher: t.fetcher, events: t.events, taskId: t.task.id, subtask: sub })).rejects.toThrow(/unusable/);
  });
});
