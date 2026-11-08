/**
 * Number check: every number a claim states must appear in the passage it
 * cites. Values are compared after normalising separators and magnitude words,
 * so "$5.2 billion", "5,200,000,000" and "5.2bn" are the same number. Rounded
 * or changed values are not the same number.
 */

const MAGNITUDES: Record<string, number> = {
  thousand: 1e3, k: 1e3, million: 1e6, mn: 1e6, mm: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, tn: 1e12, t: 1e12,
};

export interface FoundNumber {
  /** Text as it appeared. */
  raw: string;
  value: number;
  percent: boolean;
}

const NUMBER_RE = /(?<![\w.])(\d{1,3}(?:[,  ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)\s*(%|percent\b|per cent\b|thousand\b|million\b|billion\b|trillion\b|bn\b|mn\b|tn\b|k\b|m\b|b\b|t\b)?/gi;

/** Pull numbers out of text. Magnitude words and suffixes scale the value. */
export function extractNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const digits = m[1]!.replace(/[,  ]/g, '');
    const base = Number(digits);
    if (!Number.isFinite(base)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    const percent = unit === '%' || unit === 'percent' || unit === 'per cent';
    const scale = !percent && unit ? MAGNITUDES[unit] ?? 1 : 1;
    out.push({ raw: m[0].trim(), value: round(base * scale), percent });
  }
  return out;
}

const round = (n: number): number => Number(n.toPrecision(12));

export interface NumberCheck {
  ok: boolean;
  /** Numbers in the claim that the passage does not contain. */
  missing: FoundNumber[];
  claimNumbers: FoundNumber[];
}

/** Check that all numbers in `claim` appear in `passage` (same value; a percentage only matches a percentage). */
export function checkNumbers(claim: string, passage: string): NumberCheck {
  const claimNumbers = extractNumbers(claim);
  const available = extractNumbers(passage);
  const missing = claimNumbers.filter((c) => !available.some((a) => a.value === c.value && (!c.percent || a.percent)));
  return { ok: missing.length === 0, missing, claimNumbers };
}
