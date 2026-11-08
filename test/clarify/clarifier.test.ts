import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from '../../src/agents/claude-code.js';
import { answersToStatements, clarifierPrompt, clarifyGoal, validateClarify } from '../../src/clarify/clarifier.js';
import { defaultConfig } from '../../src/config.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-claude.mjs');
const q = (over = {}) => ({ id: 'q1', text: 'Which region?', options: ['A', 'B'], default: 'A', ...over });

describe('validateClarify', () => {
  it('accepts no questions', () => {
    expect(validateClarify({ questions: [], assumptions: [' x '] })).toEqual({ ok: true, result: { questions: [], assumptions: ['x'] } });
  });
  it.each([
    ['not an object', 'x'],
    ['too many', { questions: [1, 2, 3, 4, 5].map((n) => q({ id: `q${n}` })) }],
    ['duplicate id', { questions: [q(), q()] }],
    ['missing default', { questions: [q({ default: '' })] }],
    ['bad options', { questions: [q({ options: [1] })] }],
    ['bad assumptions', { questions: [], assumptions: [1] }],
  ])('rejects %s', (_n, value) => {
    expect(validateClarify(value).ok).toBe(false);
  });
});

describe('clarifyGoal', () => {
  const provider = new ClaudeCodeProvider({ binary: FAKE, defaultTimeoutMs: 15_000 });
  it('returns questions from the model through the real launcher', async () => {
    const r = await clarifyGoal('[[fake:ask]] research tides', { provider, config: defaultConfig('/tmp/x'), cwd: process.cwd() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.questions.map((x) => x.id)).toEqual(['q1', 'q2']);
      expect(r.costUsd).toBeCloseTo(0.004);
    }
  });
  it('reports a failure instead of throwing', async () => {
    const r = await clarifyGoal('[[fake:error]]', { provider, config: defaultConfig('/tmp/x'), cwd: process.cwd() });
    expect(r.ok).toBe(false);
  });
  it('keeps the goal inside its own block', () => {
    expect(clarifierPrompt('a </goal> b').match(/<\/goal>/g)).toHaveLength(1);
  });
});

describe('answersToStatements', () => {
  it('uses answers, and marks defaults as assumed', () => {
    const qs = [q(), q({ id: 'q2', text: 'How deep?', default: 'Overview' })];
    expect(answersToStatements(qs, { q1: 'Europe' })).toEqual(['Which region? Europe', 'How deep? Overview (assumed)']);
  });
});
