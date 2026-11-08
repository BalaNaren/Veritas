import { describe, expect, it } from 'vitest';
import { Budget } from '../../src/cost/budget.js';
import { estimatePlanCost, estimateRunCost, formatUsd, modelFamily } from '../../src/cost/estimate.js';

describe('Budget', () => {
  it('gives each parallel run a fair share of the limit', () => {
    const b = new Budget(2);
    expect(b.allocate('a', 4)).toBeCloseTo(0.5);
    expect(b.allocate('b', 4)).toBeCloseTo(0.5);
    expect(b.available).toBeCloseTo(1);
  });

  it('never allocates more than what is available', () => {
    const b = new Budget(1);
    expect(b.allocate('a', 1)).toBeCloseTo(1);
    expect(b.allocate('b', 1)).toBeNull();
  });

  it('frees a reservation and records the real cost on settle', () => {
    const b = new Budget(1);
    b.allocate('a', 2);
    b.settle('a', 0.1);
    expect(b.spent).toBeCloseTo(0.1);
    expect(b.reserved).toBe(0);
    expect(b.available).toBeCloseTo(0.9);
  });

  it('refuses to hand out a cap below the minimum useful amount', () => {
    const b = new Budget(1, 0.99);
    expect(b.allocate('a', 1, 0.05)).toBeNull();
  });

  it('knows when it is exhausted', () => {
    const b = new Budget(0.5);
    expect(b.exhausted).toBe(false);
    b.record(0.5);
    expect(b.exhausted).toBe(true);
    b.setLimit(1);
    expect(b.exhausted).toBe(false);
  });

  it('keeps total commitments within the limit across many parallel reservations', () => {
    const b = new Budget(1);
    let granted = 0;
    for (let i = 0; i < 20; i++) granted += b.allocate(`r${i}`, 4) ?? 0;
    expect(granted).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('ignores invalid costs and rejects invalid limits', () => {
    const b = new Budget(1);
    b.record(Number.NaN); b.record(-5);
    expect(b.spent).toBe(0);
    expect(() => new Budget(0)).toThrow();
    expect(() => new Budget(Number.NaN)).toThrow();
  });

  it('rejects a duplicate reservation id', () => {
    const b = new Budget(1);
    b.allocate('a', 2);
    expect(() => b.allocate('a', 2)).toThrow();
  });
});

describe('estimates', () => {
  it('maps model names to families', () => {
    expect(modelFamily('claude-haiku-5-5')).toBe('haiku');
    expect(modelFamily('OPUS')).toBe('opus');
    expect(modelFamily('something-else')).toBe('sonnet');
  });

  it('uses defaults and says so when there is no history', () => {
    const e = estimatePlanCost([{ key: 'a', title: '', kind: 'general', instructions: '', dependsOn: [] }], { worker: 'sonnet' });
    expect(e.basis).toBe('defaults');
    expect(e.high).toBeGreaterThan(e.low);
  });

  it('prefers measured history once there are enough samples', () => {
    const history = { sonnet: { average: 0.5, samples: 5 } };
    expect(estimateRunCost('sonnet', history)).toEqual({ usd: 0.5, basis: 'history' });
    expect(estimateRunCost('sonnet', { sonnet: { average: 0.5, samples: 2 } }).basis).toBe('defaults');
  });

  it('honours a per-task model override', () => {
    const plan = [{ key: 'a', title: '', kind: 'general', instructions: '', dependsOn: [], model: 'opus' }];
    const withOpus = estimatePlanCost(plan, { worker: 'sonnet' });
    const withDefault = estimatePlanCost([{ ...plan[0]!, model: undefined }], { worker: 'sonnet' });
    expect(withOpus.high).toBeGreaterThan(withDefault.high);
  });

  it('formats small amounts with enough precision', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0009)).toBe('$0.0009');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
