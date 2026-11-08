import { describe, expect, it } from 'vitest';
import { Policy, type PolicyRule } from '../../src/policy/policy.js';

describe('Policy', () => {
  it('uses the default rules', () => {
    const p = new Policy();
    expect(p.evaluate('agent.run').decision).toBe('allow');
    expect(p.evaluate('plan.start').decision).toBe('ask');
    expect(p.evaluate('payment.make').decision).toBe('deny');
  });

  it('denies anything without a rule', () => {
    const r = new Policy().evaluate('something.new');
    expect(r.decision).toBe('deny');
    expect(r.reason).toContain('something.new');
  });

  it('prefers exact rules over prefixes, and longer prefixes over shorter', () => {
    const rules: PolicyRule[] = [
      { action: 'git.*', decision: 'ask', reason: 'g' },
      { action: 'git.push', decision: 'deny', reason: 'p' },
      { action: 'git.commit.*', decision: 'allow', reason: 'c' },
      { action: '*', decision: 'deny', reason: 'all' },
    ];
    const p = new Policy(rules);
    expect(p.evaluate('git.push').decision).toBe('deny');
    expect(p.evaluate('git.commit.amend').decision).toBe('allow');
    expect(p.evaluate('git.merge').decision).toBe('ask');
    expect(p.evaluate('other').decision).toBe('deny');
  });

  it('lets an explicit user choice pre-approve an ask rule', () => {
    const p = new Policy().withAllowed(['plan.start'], 'user passed --yes-plan');
    const r = p.evaluate('plan.start');
    expect(r.decision).toBe('allow');
    expect(r.reason).toContain('--yes-plan');
  });

  it('never lets a pre-approval override a deny rule', () => {
    const p = new Policy().withAllowed(['payment.make', 'email.send'], 'flag');
    expect(p.evaluate('payment.make').decision).toBe('deny');
    expect(p.evaluate('email.send').decision).toBe('deny');
  });

  it('never lets a pre-approval override a locked rule', () => {
    const p = new Policy().withAllowed(['budget.exceed'], 'flag');
    expect(p.evaluate('budget.exceed').decision).toBe('ask');
  });

  it('does not change the original policy', () => {
    const p = new Policy();
    p.withAllowed(['plan.start'], 'flag');
    expect(p.evaluate('plan.start').decision).toBe('ask');
  });

  it('pre-approves actions covered only by an ask prefix', () => {
    const base = new Policy([{ action: 'git.*', decision: 'ask', reason: 'g' }]);
    expect(base.withAllowed(['git.commit'], 'flag').evaluate('git.commit').decision).toBe('allow');
    expect(base.withAllowed(['git.commit'], 'flag').evaluate('git.push').decision).toBe('ask');
  });
});
