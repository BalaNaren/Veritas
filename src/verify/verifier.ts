import { ageInDays } from '../evidence/quality.js';
import type { CheckResult, ClaimRow, ClaimStatus, EvidenceStore, SourceRow } from '../evidence/evidence-store.js';
import type { Checker } from './checker.js';
import { checkNumbers } from './numbers.js';
import { findQuote, passageAround } from './text-match.js';

export interface VerifyOptions {
  evidence: EvidenceStore;
  checker: Checker;
  taskId: string;
  /** How many claims are checked at once. */
  concurrency?: number;
  /** Called before each claim; return true to stop (for example when the budget is used up). */
  shouldStop?: () => boolean;
  signal?: AbortSignal;
  /** Called after each claim has its final status. */
  onClaim?: (claim: ClaimRow) => void;
  now?: Date;
}

export interface VerificationSummary {
  checked: number;
  confirmed: number;
  flagged: number;
  removed: number;
  analysis: number;
  notChecked: number;
  sources: { total: number; primary: number; secondary: number; unrated: number };
  /** Plain-language reasons, grouped for the summary line. */
  flaggedReasons: Record<string, number>;
  removedReasons: Record<string, number>;
  costUsd: number;
}

/** A source this old, for a claim the checker judges time-sensitive, gets flagged as possibly out of date. */
export const STALE_NUMBER_DAYS = 730;
const CROSS_CANDIDATES = 5;
const MIN_OVERLAP = 0.15;

const words = (text: string): Set<string> =>
  new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

const pass = (step: string, detail: string): CheckResult => ({ step, passed: true, detail });
const fail = (step: string, detail: string): CheckResult => ({ step, passed: false, detail });

interface Outcome { status: ClaimStatus; reason: string | null; checks: CheckResult[]; sourceId: string | null; start: number | null; end: number | null; costUsd: number }

/**
 * Run the five checks on one claim.
 * 1 source exists (code)  2 quote matches (code)  3 support (checker)  4 numbers (code)  5 cross-check (checker, important claims).
 * Earlier failures stop the pipeline: a claim with no real source never reaches the checker.
 */
async function verifyOne(claim: ClaimRow, all: readonly ClaimRow[], sources: readonly SourceRow[], o: VerifyOptions): Promise<Outcome> {
  const checks: CheckResult[] = [];
  let costUsd = 0;
  const done = (status: ClaimStatus, reason: string | null, source: SourceRow | null = null, start: number | null = null, end: number | null = null): Outcome =>
    ({ status, reason, checks, sourceId: source?.id ?? null, start, end, costUsd });

  // 1. The cited source must have been fetched by Veritas during this task.
  const source = claim.url ? o.evidence.findSource(o.taskId, claim.url) : undefined;
  if (!claim.url || !source) {
    checks.push(fail('source_exists', claim.url ? `Veritas did not fetch ${claim.url} during this task` : 'No source was given'));
    return done('removed', 'The source was not fetched during this task');
  }
  checks.push(pass('source_exists', `Fetched ${source.finalUrl} at ${source.fetchedAt}`));

  // 2. The quote must be in the stored text (formatting differences only).
  if (!claim.quote) {
    checks.push(fail('quote_matches', 'No quote was given'));
    return done('removed', 'No supporting quote was given', source);
  }
  const snapshot = o.evidence.readSnapshot(source);
  const match = findQuote(snapshot, claim.quote);
  if (!match.found) {
    checks.push(fail('quote_matches', match.reason ?? 'The quote is not in the source'));
    return done('removed', 'The quote is not in the source', source);
  }
  checks.push(pass('quote_matches', `Found at characters ${match.start}-${match.end} of the stored text`));
  const exact = snapshot.slice(match.start!, match.end!);

  // 4 (before 3, because it is free): numbers in the claim must be in the quote.
  const nums = checkNumbers(claim.text, exact);
  let numbersReason: string | null = null;
  if (!nums.ok) {
    const list = nums.missing.map((m) => m.raw).join(', ');
    checks.push(fail('numbers', `The claim states ${list}, which the quote does not contain`));
    if (claim.type === 'number') return done('removed', `Number not in the quote: ${list}`, source, match.start!, match.end!);
    numbersReason = `Figures not in the quote: ${list}`;
  } else if (nums.claimNumbers.length) {
    checks.push(pass('numbers', `All ${nums.claimNumbers.length} number(s) appear in the quote`));
  }

  // 3. An independent checker judges whether the passage supports the claim.
  const passage = passageAround(snapshot, match.start!, match.end!);
  const support = await o.checker.support({ claim: claim.text, passage, source: { title: source.title, url: source.finalUrl } });
  costUsd += support.costUsd;
  if (support.verdict === 'not_supported' || support.verdict === 'contradicted') {
    checks.push(fail('support', `${support.verdict === 'contradicted' ? 'Contradicted' : 'Not supported'}: ${support.reason}`));
    return done('removed', support.verdict === 'contradicted' ? 'Contradicted by its source' : 'Not supported by its source', source, match.start!, match.end!);
  }
  checks.push(support.verdict === 'supported' ? pass('support', support.reason) : fail('support', `Only partly supported: ${support.reason}`));

  const flags: string[] = [];
  if (support.verdict === 'partial') flags.push('Only partly supported by its source');
  if (numbersReason) flags.push(numbersReason);

  // Source quality and age.
  if (claim.important && source.quality === 'unrated') flags.push('Important claim backed only by a source that is not on the recognised lists');
  const age = ageInDays(source.publishedAt, o.now);
  if (support.timeSensitive && age !== null && age > STALE_NUMBER_DAYS) flags.push(`Source is ${Math.floor(age / 365)} years old for a figure that may have changed`);

  // 5. Important claims are compared with what other sources say.
  if (claim.important) {
    const mine = words(claim.text);
    const others = all
      .filter((c) => c.id !== claim.id && c.quote && c.url && o.evidence.getClaim(c.id)?.status !== 'removed')
      .filter((c) => { const s = sources.find((x) => c.url === x.url || c.url === x.finalUrl); return s && s.id !== source.id; })
      .map((c) => ({ c, score: overlap(mine, words(c.text)) }))
      .filter((x) => x.score >= MIN_OVERLAP)
      .sort((a, b) => b.score - a.score)
      .slice(0, CROSS_CANDIDATES);
    if (others.length) {
      const cross = await o.checker.crossCheck({
        claim: claim.text, passage: exact, others: others.map(({ c }) => ({ id: `c${c.seq}`, text: c.text, quote: c.quote! })),
      });
      costUsd += cross.costUsd;
      if (cross.verdict === 'disagree') {
        checks.push(fail('cross_check', `Other sources disagree (${cross.against.join(', ') || 'unspecified'}): ${cross.reason}`));
        flags.push(`Sources disagree: ${cross.reason}`);
      } else {
        checks.push(pass('cross_check', cross.verdict === 'agree' ? `Agrees with ${others.length} other source(s): ${cross.reason}` : `Other sources do not address it: ${cross.reason}`));
      }
    } else {
      checks.push(pass('cross_check', 'No other source in this task covers this claim (single source)'));
    }
  }

  return flags.length ? done('flagged', flags.join('; '), source, match.start!, match.end!) : done('confirmed', null, source, match.start!, match.end!);
}

/** Verify every pending claim of a task and return the summary. Claims already decided are left alone. */
export async function verifyClaims(o: VerifyOptions): Promise<VerificationSummary> {
  const sources = o.evidence.listSources(o.taskId);
  const all = o.evidence.listClaims(o.taskId);
  const pending = all.filter((c) => c.status === 'pending');
  let costUsd = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      const claim = pending[next++]!;
      if (o.signal?.aborted || o.shouldStop?.()) continue; // stays pending and is counted as not checked
      let outcome: Outcome;
      try {
        outcome = await verifyOne(claim, all, sources, o);
      } catch (e) {
        // A claim the checker could not judge is never silently accepted.
        const message = e instanceof Error ? e.message : String(e);
        outcome = { status: 'flagged', reason: `Could not be fully checked: ${message}`, checks: [fail('support', message)], sourceId: null, start: null, end: null, costUsd: 0 };
      }
      costUsd += outcome.costUsd;
      const updated = o.evidence.updateClaim(claim.id, {
        status: outcome.status, reason: outcome.reason, checks: outcome.checks,
        sourceId: outcome.sourceId, quoteStart: outcome.start, quoteEnd: outcome.end,
      });
      o.onClaim?.(updated);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, pending.length || 1)) }, worker));
  return summarize(o.evidence, o.taskId, costUsd);
}

/** Count outcomes for the verification summary. */
export function summarize(evidence: EvidenceStore, taskId: string, costUsd = 0): VerificationSummary {
  const claims = evidence.listClaims(taskId);
  const sources = evidence.listSources(taskId);
  const count = (s: ClaimStatus): number => claims.filter((c) => c.status === s).length;
  const reasons = (s: ClaimStatus): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const c of claims.filter((x) => x.status === s)) for (const r of (c.reason ?? 'No reason recorded').split('; ')) out[r] = (out[r] ?? 0) + 1;
    return out;
  };
  const used = new Set(claims.filter((c) => c.status !== 'removed' && c.sourceId).map((c) => c.sourceId));
  const usedSources = sources.filter((s) => used.has(s.id));
  return {
    checked: claims.filter((c) => c.status !== 'pending').length,
    confirmed: count('confirmed'), flagged: count('flagged'), removed: count('removed'), analysis: count('analysis'),
    notChecked: count('pending'),
    sources: {
      total: usedSources.length,
      primary: usedSources.filter((s) => s.quality === 'primary').length,
      secondary: usedSources.filter((s) => s.quality === 'secondary').length,
      unrated: usedSources.filter((s) => s.quality === 'unrated').length,
    },
    flaggedReasons: reasons('flagged'), removedReasons: reasons('removed'), costUsd,
  };
}
