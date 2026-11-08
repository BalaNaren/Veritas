import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvidenceStore } from '../../src/evidence/evidence-store.js';
import { ageInDays, rateSource } from '../../src/evidence/quality.js';
import { Store } from '../../src/storage/store.js';

const homes: string[] = [];
afterEach(() => { while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true }); });

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'veritas-ev-'));
  homes.push(home);
  const store = Store.open(':memory:');
  const task = store.createTask({ slug: 't', goal: 'g', type: 'research', budgetUsd: 1, mode: 'x', cwd: '/' });
  return { ev: new EvidenceStore(store, home), task, store };
}
const src = (taskId: string, over = {}) => ({
  taskId, url: 'https://www.nasa.gov/a', finalUrl: 'https://www.nasa.gov/a', contentType: 'text/html', bytes: 100, sha256: 'ab', fetchedAt: '2026-01-01T00:00:00Z', text: 'The Moon is about 384,400 km away.', ...over,
});

describe('EvidenceStore', () => {
  it('stores a snapshot privately, rates it, and reads it back', () => {
    const { ev, task } = setup();
    const s = ev.addSource(src(task.id, { title: 'Moon' }));
    expect(s.quality).toBe('primary');
    expect(statSync(s.snapshotPath).mode & 0o777).toBe(0o600);
    expect(ev.readSnapshot(s)).toBe('The Moon is about 384,400 km away.');
  });

  it('returns the same record for the same final address', () => {
    const { ev, task } = setup();
    const a = ev.addSource(src(task.id));
    const b = ev.addSource(src(task.id, { url: 'https://nasa.gov/short' }));
    expect(b.id).toBe(a.id);
    expect(ev.listSources(task.id)).toHaveLength(1);
    expect(ev.findSource(task.id, 'https://www.nasa.gov/a')?.id).toBe(a.id);
  });

  it('detects a snapshot that was edited after it was saved', () => {
    const { ev, task } = setup();
    const s = ev.addSource(src(task.id));
    writeFileSync(s.snapshotPath, 'The Moon is 1 km away.');
    expect(() => ev.readSnapshot(s)).toThrow(/has been changed/);
  });

  it('numbers claims per task and records check results', () => {
    const { ev, task, store } = setup();
    const other = store.createTask({ slug: 'o', goal: 'g', type: 'research', budgetUsd: 1, mode: 'x', cwd: '/' });
    const c1 = ev.addClaim({ taskId: task.id, text: 'a', type: 'fact' });
    const c2 = ev.addClaim({ taskId: task.id, text: 'b', type: 'number', important: true });
    expect([c1.seq, c2.seq, ev.addClaim({ taskId: other.id, text: 'x', type: 'fact' }).seq]).toEqual([1, 2, 1]);
    const u = ev.updateClaim(c1.id, { status: 'confirmed', checks: [{ step: 'quote_matches', passed: true, detail: 'ok' }], quoteStart: 4, quoteEnd: 8 });
    expect(u).toMatchObject({ status: 'confirmed', quoteStart: 4, quoteEnd: 8 });
    expect(u.checks[0]!.step).toBe('quote_matches');
    expect(c2.important).toBe(true);
    expect(ev.listClaims(task.id, 'confirmed')).toHaveLength(1);
    expect(ev.listClaims(task.id)).toHaveLength(2);
  });
});

describe('rateSource', () => {
  it.each([
    ['https://www.nasa.gov/x', 'primary'], ['https://www.cdc.gov/y', 'primary'], ['https://ocw.mit.edu/z', 'primary'],
    ['https://www.ons.gov.uk/a', 'primary'], ['https://www.ox.ac.uk/a', 'primary'], ['https://ec.europa.eu/a', 'primary'],
    ['https://arxiv.org/abs/1', 'primary'], ['https://www.reuters.com/a', 'secondary'], ['https://en.wikipedia.org/wiki/Moon', 'secondary'],
    ['https://myblog.example.com/post', 'unrated'], ['https://nasa.gov.evil.com/a', 'unrated'], ['https://notnasa.gov.example/a', 'unrated'], ['nonsense', 'unrated'],
  ])('%s is %s', (url, expected) => expect(rateSource(url).quality).toBe(expected));
});

describe('ageInDays', () => {
  it('counts whole days and tolerates missing or unreadable dates', () => {
    const now = new Date('2026-01-31T12:00:00Z');
    expect(ageInDays('2026-01-01', now)).toBe(30);
    expect(ageInDays('2027-01-01', now)).toBe(0);
    expect(ageInDays(null, now)).toBeNull();
    expect(ageInDays('last Tuesday', now)).toBeNull();
  });
});
