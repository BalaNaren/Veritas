import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRunRequest, AgentRunResult, ModelProvider } from '../../src/agents/provider.js';
import { defaultConfig } from '../../src/config.js';
import { Engine, type Approver } from '../../src/engine/engine.js';
import { Policy } from '../../src/policy/policy.js';
import { Store } from '../../src/storage/store.js';

const homes: string[] = [];
afterEach(() => { while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true }); });

const plan = {
  subtasks: [
    { key: 't1', title: 'One', kind: 'general', instructions: 'do one', dependsOn: [] },
    { key: 't2', title: 'Two', kind: 'general', instructions: 'do two', dependsOn: ['t1'] },
  ],
  assumptions: ['Assumed English'],
};
const ok = (over: Partial<AgentRunResult>): AgentRunResult => ({
  ok: true, text: '', costUsd: 0.01, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 1, numTurns: 1, ...over,
});

function fakeProvider(opts: { workerCost?: number; planOk?: boolean; onRun?: (r: AgentRunRequest) => void } = {}): ModelProvider {
  return {
    id: 'claude-code',
    async run(r) {
      opts.onRun?.(r);
      if (r.jsonSchema) {
        return opts.planOk === false
          ? ok({ ok: false, error: { kind: 'process', message: 'boom' } })
          : ok({ json: plan, costUsd: 0.02 });
      }
      return ok({ text: `done: ${r.prompt.includes('do two') ? 'two' : 'one'}`, costUsd: opts.workerCost ?? 0.05 });
    },
  };
}

function setup(provider = fakeProvider(), policy?: Policy) {
  const home = mkdtempSync(join(tmpdir(), 'veritas-eng-'));
  homes.push(home);
  const config = { ...defaultConfig(home), maxConcurrent: 2 };
  const store = Store.open(':memory:');
  const engine = new Engine({ store, provider, config, policy, retryDelayMs: 0 });
  return { engine, store, home };
}
const yes: Approver = async () => 'approved';
const later: Approver = async () => 'defer';

describe('Engine', () => {
  it('plans, runs and writes a private result file', async () => {
    const { engine, store } = setup();
    const t = engine.createTask('Explain tides', { budgetUsd: 2 });
    const { task, resultPath } = await engine.execute(t.id, { approver: yes });
    expect(task.status).toBe('done');
    expect(task.assumptions).toEqual(['Assumed English']);
    expect(task.spentUsd).toBeCloseTo(0.02 + 0.05 * 2);
    expect(existsSync(resultPath!)).toBe(true);
    expect(statSync(resultPath!).mode & 0o777).toBe(0o600);
    const text = readFileSync(resultPath!, 'utf8');
    expect(text).toContain('# Explain tides');
    expect(text).toContain('done: two');
    expect(text).not.toContain('done: one');
    const types = store.listEvents(t.id).map((e) => e.type);
    expect(types.indexOf('plan.created')).toBeLessThan(types.indexOf('approval.approved'));
    expect(types.indexOf('approval.approved')).toBeLessThan(types.indexOf('task.done'));
  });

  it('waits for approval when nobody is asked, then continues once decided', async () => {
    const { engine, store } = setup();
    const t = engine.createTask('goal');
    const first = await engine.execute(t.id);
    expect(first.task.status).toBe('awaiting_approval');
    const [approval] = store.listApprovals(t.id, 'pending');
    expect(approval!.action).toBe('plan.start');
    engine.decide(approval!.id, 'approved');
    expect((await engine.execute(t.id)).task.status).toBe('done');
    expect(store.listApprovals(t.id)).toHaveLength(1);
  });

  it('does not ask twice when run again before a decision', async () => {
    const { engine, store } = setup();
    const t = engine.createTask('goal');
    await engine.execute(t.id);
    await engine.execute(t.id);
    expect(store.listApprovals(t.id)).toHaveLength(1);
  });

  it('cancels when the plan is denied and spends nothing on workers', async () => {
    const { engine } = setup();
    const t = engine.createTask('goal');
    const r = await engine.execute(t.id, { approver: async () => 'denied' });
    expect(r.task.status).toBe('cancelled');
    expect(r.task.spentUsd).toBeCloseTo(0.02);
  });

  it('runs without asking when the plan was pre-approved by a flag', async () => {
    const { engine } = setup(fakeProvider(), new Policy().withAllowed(['plan.start'], 'passed --yes-plan'));
    const t = engine.createTask('goal');
    expect((await engine.execute(t.id)).task.status).toBe('done');
  });

  it('can never pre-approve going over budget', () => {
    const p = new Policy().withAllowed(['budget.exceed'], 'flag');
    expect(p.evaluate('budget.exceed').decision).toBe('ask');
  });

  it('pauses at the budget, asks, and continues after a raise is approved', async () => {
    const { engine, store } = setup(fakeProvider({ workerCost: 0.3 }));
    const t = engine.createTask('goal', { budgetUsd: 0.3 });
    const r = await engine.execute(t.id, { approver: async ({ approval }) => (approval.action === 'plan.start' ? 'approved' : 'defer') });
    expect(r.task.status).toBe('paused');
    const pending = store.listApprovals(t.id, 'pending');
    expect(pending.map((a) => a.action)).toEqual(['budget.exceed']);
    engine.decide(pending[0]!.id, 'approved');
    const again = await engine.execute(t.id);
    expect(again.task.status).toBe('done');
    expect(again.task.budgetUsd).toBeCloseTo(0.6);
  });

  it('stays paused when the budget raise is denied', async () => {
    const { engine } = setup(fakeProvider({ workerCost: 0.3 }));
    const t = engine.createTask('goal', { budgetUsd: 0.3 });
    const r = await engine.execute(t.id, { approver: async ({ approval }) => (approval.action === 'plan.start' ? 'approved' : 'denied') });
    expect(r.task.status).toBe('paused');
    expect(r.task.budgetUsd).toBeCloseTo(0.3);
  });

  it('fails clearly when planning fails', async () => {
    const { engine } = setup(fakeProvider({ planOk: false }));
    const t = engine.createTask('goal');
    const r = await engine.execute(t.id, { approver: yes });
    expect(r.task.status).toBe('failed');
    expect(r.task.error).toMatch(/Planning failed/);
  });

  it('pauses (resumable) when interrupted', async () => {
    const ac = new AbortController();
    const provider = fakeProvider({ onRun: (r) => { if (!r.jsonSchema) ac.abort(); } });
    const { engine } = setup(provider);
    const t = engine.createTask('goal');
    const r = await engine.execute(t.id, { approver: yes, signal: ac.signal });
    expect(r.task.status).toBe('paused');
  });

  it('refuses to run a cancelled task and rejects an empty goal', async () => {
    const { engine } = setup();
    expect(() => engine.createTask('   ')).toThrow(/empty/);
    const t = engine.createTask('goal');
    engine.cancel(t.id);
    expect((await engine.execute(t.id, { approver: yes })).task.status).toBe('cancelled');
  });

  it('ignores a decision on an approval that is already decided', async () => {
    const { engine, store } = setup();
    const t = engine.createTask('goal');
    await engine.execute(t.id);
    const a = store.listApprovals(t.id)[0]!;
    engine.decide(a.id, 'approved');
    expect(() => engine.decide(a.id, 'denied')).toThrow(/already decided/);
  });
});
