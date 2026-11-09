import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, type ClaimStatus, type ClaimType } from '../evidence/evidence-store.js';
import { Store } from '../storage/store.js';
import type { Checker } from '../verify/checker.js';
import { verifyClaims } from '../verify/verifier.js';

export interface GoldenData {
  note: string;
  snapshots: Record<string, { title: string; url: string; text: string }>;
  facts: {
    source: string; quote: string; supported: string; stretched: string; contradicted: string; fake: string; wrongNumber: string | null;
  }[];
}

/** How a case is meant to be caught. */
export type CaseKind = 'supported' | 'stretched' | 'contradicted' | 'fabricated_quote' | 'wrong_number' | 'invented_source';

export interface GoldenCase {
  id: string;
  kind: CaseKind;
  source: string;
  claim: string;
  type: ClaimType;
  quote: string;
  /** The address cited (an address that was never fetched for `invented_source`). */
  url: string;
  /** Only `supported` claims may end up confirmed. */
  shouldBeConfirmed: boolean;
  /** Whether plain code (steps 1, 2, 4) is expected to reject it without any AI. */
  caughtByCode: boolean;
}

export const loadGolden = (path: string): GoldenData => JSON.parse(readFileSync(path, 'utf8')) as GoldenData;

export function buildCases(data: GoldenData): GoldenCase[] {
  const cases: GoldenCase[] = [];
  data.facts.forEach((f, i) => {
    const src = data.snapshots[f.source];
    if (!src) throw new Error(`Golden fact ${i} names an unknown snapshot: ${f.source}`);
    const base = { source: f.source, url: src.url };
    const id = (k: string): string => `f${String(i + 1).padStart(2, '0')}-${k}`;
    cases.push({ ...base, id: id('supported'), kind: 'supported', claim: f.supported, type: 'fact', quote: f.quote, shouldBeConfirmed: true, caughtByCode: false });
    cases.push({ ...base, id: id('stretched'), kind: 'stretched', claim: f.stretched, type: 'fact', quote: f.quote, shouldBeConfirmed: false, caughtByCode: false });
    cases.push({ ...base, id: id('contradicted'), kind: 'contradicted', claim: f.contradicted, type: 'fact', quote: f.quote, shouldBeConfirmed: false, caughtByCode: false });
    cases.push({ ...base, id: id('fake'), kind: 'fabricated_quote', claim: f.fake, type: 'fact', quote: f.fake, shouldBeConfirmed: false, caughtByCode: true });
    if (f.wrongNumber) cases.push({ ...base, id: id('number'), kind: 'wrong_number', claim: f.wrongNumber, type: 'number', quote: f.quote, shouldBeConfirmed: false, caughtByCode: true });
    // Every fourth fact also gets a copy citing a page nobody fetched.
    if (i % 4 === 0) cases.push({ ...base, id: id('nosrc'), kind: 'invented_source', url: `https://invented.example/${f.source}`, claim: f.supported, type: 'fact', quote: f.quote, shouldBeConfirmed: false, caughtByCode: true });
  });
  return cases;
}

export interface CaseResult { case: GoldenCase; status: ClaimStatus; reason: string | null; checkerCalled: boolean }

export interface EvalReport {
  total: number;
  results: CaseResult[];
  /** Per kind: how many ended in each status. */
  byKind: Record<string, Record<string, number>>;
  checkerCalls: number;
  costUsd: number;
}

/** Run every golden case through the real verifier with the given checker, in a throwaway database. */
export async function runGoldenEval(data: GoldenData, checker: Checker, opts: { concurrency?: number } = {}): Promise<EvalReport> {
  const home = mkdtempSync(join(tmpdir(), 'veritas-golden-'));
  try {
    const store = Store.open(':memory:');
    const task = store.createTask({ slug: 'golden', goal: 'golden', type: 'research', budgetUsd: 100, mode: 'eval', cwd: home });
    const evidence = new EvidenceStore(store, home);
    for (const s of Object.values(data.snapshots)) {
      evidence.addSource({ taskId: task.id, url: s.url, finalUrl: s.url, title: s.title, contentType: 'text/plain', bytes: s.text.length, sha256: 'golden', fetchedAt: new Date().toISOString(), text: s.text });
    }
    const cases = buildCases(data);
    const ids = new Map<string, GoldenCase>();
    for (const c of cases) ids.set(evidence.addClaim({ taskId: task.id, text: c.claim, type: c.type, url: c.url, quote: c.quote }).id, c);

    let calls = 0;
    const counting: Checker = {
      async support(i) { calls++; return checker.support(i); },
      async crossCheck(i) { return checker.crossCheck(i); },
    };
    const summary = await verifyClaims({ evidence, checker: counting, taskId: task.id, concurrency: opts.concurrency ?? 4 });

    const results: CaseResult[] = [];
    const byKind: Record<string, Record<string, number>> = {};
    for (const claim of evidence.listClaims(task.id)) {
      const c = ids.get(claim.id)!;
      const checkerCalled = claim.checks.some((x) => x.step === 'support');
      results.push({ case: c, status: claim.status, reason: claim.reason, checkerCalled });
      byKind[c.kind] ??= {};
      byKind[c.kind]![claim.status] = (byKind[c.kind]![claim.status] ?? 0) + 1;
    }
    store.close();
    return { total: cases.length, results, byKind, checkerCalls: calls, costUsd: summary.costUsd };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
