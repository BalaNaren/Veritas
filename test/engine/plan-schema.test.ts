import { describe, expect, it } from 'vitest';
import { hasCycle, planJsonSchema, validatePlanDraft } from '../../src/engine/plan-schema.js';

const limits = { maxSubtasks: 4, kinds: ['general'] };
const t = (key: string, dependsOn: string[] = []) => ({ key, title: key, kind: 'general', instructions: 'do ' + key, dependsOn });

describe('validatePlanDraft', () => {
  it('accepts a valid plan and canonicalises dependency keys', () => {
    const r = validatePlanDraft({ subtasks: [t('A'), t('b', ['a'])], assumptions: [' x '] }, limits);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.subtasks[1]!.dependsOn).toEqual(['A']);
      expect(r.draft.assumptions).toEqual(['x']);
    }
  });

  it.each([
    ['non-object', 'x', /JSON object/],
    ['empty', { subtasks: [] }, /non-empty/],
    ['too many', { subtasks: ['a', 'b', 'c', 'd', 'e'].map((k) => t(k)) }, /at most 4/],
    ['duplicate', { subtasks: [t('a'), t('A')] }, /more than once/],
    ['bad key', { subtasks: [t('1x')] }, /key/],
    ['bad kind', { subtasks: [{ ...t('a'), kind: 'magic' }] }, /kind/],
    ['unknown dep', { subtasks: [t('a', ['zz'])] }, /unknown task/],
    ['self dep', { subtasks: [t('a', ['a'])] }, /itself/],
    ['cycle', { subtasks: [t('a', ['b']), t('b', ['a'])] }, /circle/],
    ['bad assumptions', { subtasks: [t('a')], assumptions: [1] }, /assumptions/],
  ])('rejects %s', (_n, value, re) => {
    const r = validatePlanDraft(value, limits);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(re);
  });

  it('detects cycles', () => {
    expect(hasCycle([t('a'), t('b', ['a'])])).toBe(false);
    expect(hasCycle([t('a', ['c']), t('b', ['a']), t('c', ['b'])])).toBe(true);
  });

  it('builds a schema limited to the allowed kinds', () => {
    expect(JSON.stringify(planJsonSchema(limits))).toContain('"enum":["general"]');
  });
});

describe('research plans', () => {
  const lim = { maxSubtasks: 6, kinds: ['general', 'research'] };
  const r = (key: string) => ({ key, title: key, kind: 'research', instructions: 'x', dependsOn: [] });
  it('accepts research-only plans and rejects mixing with other kinds', () => {
    expect(validatePlanDraft({ subtasks: [r('a'), r('b')], assumptions: [] }, lim).ok).toBe(true);
    const mixed = validatePlanDraft({ subtasks: [r('a'), { ...r('b'), kind: 'general' }], assumptions: [] }, lim);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.errors.join(' ')).toMatch(/only research tasks/);
  });
});
