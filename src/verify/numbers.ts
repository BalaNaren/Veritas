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
  /** False when the claim states a figure the passage does not contain. */
  ok: boolean;
  /** Figures in the claim that the passage does not contain. */
  missing: FoundNumber[];
  /**
   * Years and days of the month that the claim adds as context when the passage gives no year at all
   * (for example "In 2024, packs averaged $97/kWh" quoting only "$97/kWh"). Weaker than a wrong figure.
   */
  contextMissing: FoundNumber[];
  claimNumbers: FoundNumber[];
}

const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DAY_BEFORE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTHS}`, 'gi');
const DAY_AFTER = new RegExp(`\\b${MONTHS}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi');
const isYear = (n: FoundNumber): boolean => !n.percent && Number.isInteger(n.value) && n.value >= 1900 && n.value <= 2100 && /^\d{4}$/.test(n.raw);

function dayNumbers(text: string): Set<number> {
  const days = new Set<number>();
  for (const re of [DAY_BEFORE, DAY_AFTER]) for (const m of text.matchAll(re)) days.add(Number(m[1]));
  return days;
}

const LOCATOR_RE = /(?:\b(?:pages?|pp?\.|clauses?|sections?|articles?|paragraphs?|para\.?|schedule|appendix|annex|exhibit|item|table|figure|chapter|line|lines|row|rows|sheet)\b|§+)\s*\.?\s*\d+(?:\.\d+)*(?:\s*\([a-z0-9]{1,3}\))*(?:\s*(?:,|and|&|-|–|to)\s*\d+(?:\.\d+)*)*/gi;

/** Where in a document something is ("page 2", "Clause 4.1", "Table 3") is a pointer, not a figure the quote has to contain. */
export function stripLocators(text: string): string {
  return text.replace(LOCATOR_RE, ' ');
}

/** Check that all numbers in `claim` appear in `passage` (same value; a percentage only matches a percentage). */
export function checkNumbers(claim: string, passage: string): NumberCheck {
  const claimNumbers = extractNumbers(stripLocators(claim));
  const available = extractNumbers(passage);
  const absent = claimNumbers.filter((c) => !available.some((a) => a.value === c.value && (!c.percent || a.percent)));
  // A year or a date's day that is merely extra context is weaker than a wrong figure, but only when the passage names no year;
  // a different year in the passage means the claim contradicts it.
  const passageHasYear = available.some(isYear);
  const days = dayNumbers(claim);
  const isContext = (n: FoundNumber): boolean => !passageHasYear && (isYear(n) || (!n.percent && days.has(n.value)));
  const contextMissing = absent.filter(isContext);
  const missing = absent.filter((n) => !isContext(n));
  return { ok: missing.length === 0, missing, contextMissing, claimNumbers };
}
