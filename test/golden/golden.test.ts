import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCases, loadGolden, runGoldenEval } from '../../src/eval/golden.js';
import type { Checker } from '../../src/verify/checker.js';
import { findQuote } from '../../src/verify/text-match.js';

const data = loadGolden(join(dirname(fileURLToPath(import.meta.url)), 'facts.json'));
const cases = buildCases(data);

/** Says "supported" to everything: any wrong claim that gets through was let through by code alone. */
const yesMan: Checker = {
  support: async () => ({ verdict: 'supported', reason: 'stub', timeSensitive: false, costUsd: 0 }),
  crossCheck: async () => ({ verdict: 'agree', reason: 'stub', against: [], costUsd: 0 }),
};

describe('golden set', () => {
  it('is a sensible size and covers every kind of case', () => {
    expect(cases.length).toBeGreaterThanOrEqual(200);
    const kinds = new Set(cases.map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['contradicted', 'fabricated_quote', 'invented_source', 'stretched', 'supported', 'wrong_number']);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('has real quotes for every claim that is meant to quote its source', () => {
    for (const c of cases.filter((x) => x.kind !== 'fabricated_quote')) {
      const text = data.snapshots[c.source]!.text;
      expect(findQuote(text, c.quote).found, `${c.id}: ${c.quote}`).toBe(true);
    }
  });

  it('has fabricated quotes that really are not in their sources', () => {
    for (const c of cases.filter((x) => x.kind === 'fabricated_quote')) {
      expect(findQuote(data.snapshots[c.source]!.text, c.quote).found, c.id).toBe(false);
    }
  });
});

describe('golden set: code-only checks (no AI)', () => {
  it('lets no fabricated quote, wrong number or invented source through, and never rejects a faithful claim by code', async () => {
    const report = await runGoldenEval(data, yesMan);
    const wrongly = (pred: (r: (typeof report.results)[number]) => boolean) => report.results.filter(pred).map((r) => r.case.id);

    // Zero invented sources, zero fabricated quotes, zero altered numbers get through.
    expect(wrongly((r) => r.case.caughtByCode && r.status !== 'removed')).toEqual([]);
    // Faithful claims are never removed by code.
    expect(wrongly((r) => r.case.kind === 'supported' && r.status === 'removed')).toEqual([]);
    // The AI step is not asked about anything code already rejected.
    expect(wrongly((r) => r.case.caughtByCode && r.checkerCalled)).toEqual([]);
    expect(report.checkerCalls).toBe(cases.filter((c) => !c.caughtByCode).length);
    // Sanity: the counts match what was built.
    expect(report.byKind.fabricated_quote).toEqual({ removed: data.facts.length });
  });
});
