import type { ClaimRow } from '../evidence/evidence-store.js';
import { extractNumbers } from '../verify/numbers.js';

export const CITATION_RE = /\[c(\d+)\]/g;

export interface Violation {
  /** 0-based line of the report. */
  line: number;
  sentence: string;
  reason: string;
}

const stripCitations = (s: string): string => s.replace(CITATION_RE, '').replace(/\s+/g, ' ').trim();

/** Split one line of Markdown into sentences. Headings, rules and table separators have none to check. */
export function sentencesOf(line: string): string[] {
  const text = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
  if (!text || /^#{1,6}\s/.test(text) || /^[-=_*|:\s]+$/.test(text) || /^```/.test(text)) return [];
  return text.split(/(?<=[.!?])(?:\s*\[c\d+\])*\s+(?=[A-Z0-9"“(*_\[])/).map((s) => s.trim()).filter(Boolean);
}

const isAnalysis = (s: string): boolean => /^[*_\s]*analysis\s*:/i.test(s);

/** A sentence that states something checkable: a number, or a name in the middle of the sentence. */
export function looksFactual(sentence: string): boolean {
  const s = stripCitations(sentence).replace(/^[*_\s"“(]+/, '');
  if (/\d/.test(s)) return true;
  const afterFirst = s.split(/\s+/).slice(1).join(' ');
  return /(?:^|\s)(?!I\b)(?:[A-Z][a-z]{2,}|[A-Z]{2,})/.test(afterFirst);
}

/**
 * Check a drafted report against the claims it may use. Every factual sentence
 * must cite a claim that exists and is not removed, and every number in it must
 * come from the claims it cites. Sentences marked "Analysis:" are exempt from
 * needing a citation but are counted.
 */
export function checkReport(markdown: string, claims: readonly ClaimRow[]): { violations: Violation[]; analysisSentences: number } {
  const usable = new Map(claims.filter((c) => c.status === 'confirmed' || c.status === 'flagged').map((c) => [c.seq, c]));
  const violations: Violation[] = [];
  let analysisSentences = 0;
  markdown.split('\n').forEach((line, i) => {
    for (const sentence of sentencesOf(line)) {
      const ids = [...sentence.matchAll(CITATION_RE)].map((m) => Number(m[1]));
      if (isAnalysis(sentence)) { analysisSentences++; }
      const bad = ids.filter((id) => !usable.has(id));
      if (bad.length) { violations.push({ line: i, sentence, reason: `cites ${bad.map((b) => `[c${b}]`).join(', ')}, which is not an available claim` }); continue; }
      if (isAnalysis(sentence)) continue;
      if (!ids.length) {
        if (looksFactual(sentence)) violations.push({ line: i, sentence, reason: 'states something checkable but cites no claim' });
        continue;
      }
      const evidenceText = ids.map((id) => `${usable.get(id)!.text} ${usable.get(id)!.quote ?? ''}`).join(' ');
      const have = extractNumbers(evidenceText);
      const missing = extractNumbers(stripCitations(sentence)).filter((n) => !have.some((h) => h.value === n.value));
      if (missing.length) violations.push({ line: i, sentence, reason: `contains ${missing.map((m) => m.raw).join(', ')}, which the cited claims do not contain` });
    }
  });
  return { violations, analysisSentences };
}

/** Remove the offending sentences. A line left empty is dropped; a heading is never touched. */
export function removeViolations(markdown: string, violations: readonly Violation[]): string {
  const lines = markdown.split('\n');
  for (const v of violations) {
    const idx = lines.findIndex((l, i) => i === v.line && l.includes(v.sentence));
    if (idx >= 0) lines[idx] = lines[idx]!.replace(v.sentence, '').replace(/\s{2,}/g, ' ').trimEnd();
  }
  return lines.filter((l, i) => !(l.trim() === '' && violations.some((v) => v.line === i)) && !/^\s*(?:[-*+]|\d+[.)])\s*$/.test(l)).join('\n');
}
