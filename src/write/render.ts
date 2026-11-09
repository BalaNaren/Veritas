import type { ClaimRow, SourceRow } from '../evidence/evidence-store.js';
import type { VerificationSummary } from '../verify/verifier.js';
import { CITATION_RE } from './post-check.js';

export interface ReportInput {
  goal: string;
  assumptions: readonly string[];
  /** The report body with [c<N>] citation markers. */
  body: string;
  claims: readonly ClaimRow[];
  sources: readonly SourceRow[];
  summary: VerificationSummary;
  analysisSentences: number;
  /** Sentences taken out because they could not be tied to a claim. */
  removedSentences: readonly string[];
  /** Plain note when part of the work could not be done, for example the budget ran out. */
  notes?: readonly string[];
  /** Analysis runs whose numbers appear in the report, with the code that produced them. */
  runs?: readonly { id: string; code: string; attempt: number; backend: string }[];
  /** Charts the analysis code drew, saved next to the report. */
  charts?: readonly { path: string; caption: string }[];
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

function reasonList(reasons: Record<string, number>): string {
  const items = Object.entries(reasons).map(([r, n]) => `${n} ${r.toLowerCase()}`);
  return items.length ? ` (${items.join('; ')})` : '';
}

/** Final Markdown: assumptions, the report with numbered citations, sources, and the verification summary. */
export function renderMarkdown(r: ReportInput): string {
  const numberOf = new Map<number, number>();
  const body = r.body.replace(CITATION_RE, (_m, seq: string) => {
    const id = Number(seq);
    if (!numberOf.has(id)) numberOf.set(id, numberOf.size + 1);
    return `[${numberOf.get(id)}]`;
  });

  const out: string[] = [`# ${oneLine(r.goal)}`, ''];
  if (r.assumptions.length) out.push('## Assumptions', '', ...r.assumptions.map((a) => `- ${a}`), '');
  out.push(body.trim(), '');

  const bySeq = new Map(r.claims.map((c) => [c.seq, c]));
  const bySource = new Map(r.sources.map((s) => [s.id, s]));
  if (numberOf.size) {
    out.push('## Sources', '');
    for (const [seq, n] of [...numberOf].sort((a, b) => a[1] - b[1])) {
      const c = bySeq.get(seq)!;
      const s = c.sourceId ? bySource.get(c.sourceId) : undefined;
      const unit = s?.kind === 'file' && c.location != null ? s.units?.find((u) => u.n === c.location)?.label : undefined;
      const label = s?.kind === 'run' ? `Analysis run ${s.url.slice(4, 16)} — code in the appendix` : s?.kind === 'file' ? `${s.title ?? 'file'}${unit ? ` — ${unit}` : ''}` : s ? `${s.title ? oneLine(s.title) : s.finalUrl} — ${s.finalUrl}` : (c.url ?? 'unknown source');
      const tags = s?.kind === 'run' ? 'computed by code that ran in the sandbox' : s?.kind === 'file' ? 'your file' : s ? `${s.quality === 'unrated' ? 'unrated source' : s.quality === 'low' ? 'low-confidence source' : `${s.quality} source`}, fetched ${s.fetchedAt.slice(0, 10)}${s.publishedAt ? `, dated ${s.publishedAt.slice(0, 10)}` : ''}` : '';
      out.push(`${n}. ${label}${tags ? ` (${tags})` : ''}`, `   > ${oneLine(c.quote ?? '')}`);
      if (c.status === 'flagged') out.push(`   ⚠ Flagged: ${c.reason ?? 'see verification summary'}`);
    }
    out.push('');
  }

  if (r.charts?.length) {
    out.push('## Charts', '');
    for (const c of r.charts) out.push(`![${oneLine(c.caption).replace(/[\[\]]/g, '')}](${c.path})`, '');
    out.push('*Chart captions are the analysis agent\'s description of the picture and are not checked; the numbers behind a chart are in the code below.*', '');
  }

  const sum = r.summary;
  out.push('## Verification summary', '');
  out.push(`- Claims checked: ${sum.checked}`);
  out.push(`- ✓ Confirmed: ${sum.confirmed}`);
  out.push(`- ⚠ Flagged: ${sum.flagged}${reasonList(sum.flaggedReasons)}`);
  out.push(`- ✗ Removed: ${sum.removed}${reasonList(sum.removedReasons)}`);
  out.push(`- ◇ Analysis sentences: ${r.analysisSentences} (labelled as reasoning, not sourced fact)`);
  out.push(`- Sources used: ${sum.sources.total} (${sum.sources.primary} primary · ${sum.sources.secondary} secondary · ${sum.sources.unrated} unrated · ${sum.sources.low} low-confidence)`);
  if (sum.notChecked) out.push(`- Not checked: ${sum.notChecked} (checking stopped before they were reached)`);
  if (r.removedSentences.length) out.push(`- Sentences removed from the draft for lacking a source: ${r.removedSentences.length}`);
  out.push('', '"Confirmed" means the cited page was fetched by Veritas, the quote is on it, the numbers match and an independent checker agreed the quote supports the claim. It does not prove the page itself is correct.');
  for (const n of r.notes ?? []) out.push('', `Note: ${n}`);

  if (r.runs?.length) {
    out.push('', '## Code', '', 'This is the code that produced the computed numbers. Veritas ran it in a sandbox with no network access; the figures in the report are the values it wrote. Save it and the input files together to run it again.');
    for (const run of r.runs) out.push('', `Run ${run.id.slice(4, 16)} (attempt ${run.attempt}, ${run.backend} sandbox):`, '', '```python', run.code.replace(/```/g, "'''").trimEnd(), '```');
  }

  const removed = r.claims.filter((c) => c.status === 'removed');
  if (removed.length) {
    out.push('', '### Could not be verified', '');
    for (const c of removed) out.push(`- ${c.important ? '**Important:** ' : ''}${oneLine(c.text)} — ${c.reason ?? 'removed'}`);
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

export { plural };
