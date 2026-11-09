export const CODE_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'notes'],
  properties: {
    summary: { type: 'string', description: 'What you changed and why, in plain language, in a few sentences.' },
    notes: { type: 'string', description: 'Anything the reviewer should know: things you were unsure about, or did not do.' },
  },
} as const;

export interface CodeResult { summary: string; notes: string }

export function validateCodeResult(value: unknown): { ok: true; value: CodeResult } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'The answer must be a JSON object with "summary" and "notes".' };
  const v = value as Record<string, unknown>;
  const summary = typeof v.summary === 'string' ? v.summary.trim() : '';
  if (!summary || summary.length > 4000) return { ok: false, error: '"summary" must be 1-4000 characters.' };
  return { ok: true, value: { summary, notes: typeof v.notes === 'string' ? v.notes.trim().slice(0, 2000) : '' } };
}

const TEST_WORD = '(?:tests?|testing|suites?|specs?|ci|build)';
const OUTCOME_WORD = '(?:pass(?:es|ed|ing)?|green|succe(?:ed|eds|eded|ss|ssful(?:ly)?)|work(?:s|ed|ing)?|fix(?:es|ed)?|fail(?:s|ed|ing)?|verif(?:y|ied|ies)|ok|clean|confirm(?:s|ed)?)';
const TEST_CLAIM = new RegExp(`\\b${TEST_WORD}\\b[^.!?\\n]*\\b${OUTCOME_WORD}\\b|\\b${OUTCOME_WORD}\\b[^.!?\\n]*\\b${TEST_WORD}\\b`, 'i');

/**
 * Whatever the agent says about test outcomes is not evidence: only runs Veritas made itself are. Sentences that make
 * such statements are removed from the agent's text, and the report shows the recorded runs instead.
 */
export function stripTestClaims(text: string): { text: string; removed: number } {
  let removed = 0;
  const kept = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => {
    if (!s.trim()) return false;
    if (TEST_CLAIM.test(s)) { removed++; return false; }
    return true;
  });
  return { text: kept.join(' ').trim(), removed };
}
