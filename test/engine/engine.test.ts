import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRunRequest, AgentRunResult, ModelProvider } from '../../src/agents/provider.js';
import { defaultConfig } from '../../src/config.js';
import { Engine, type Approver } from '../../src/engine/engine.js';
import { Policy } from '../../src/policy/policy.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
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

describe('Engine clarifying', () => {
  const questionsProvider = (): ModelProvider => ({
    id: 'claude-code',
    async run(r) {
      if (r.jsonSchema && JSON.stringify(r.jsonSchema).includes('"questions"')) {
        return ok({ json: { questions: [{ id: 'q1', text: 'Which region?', options: ['EU', 'US'], default: 'US' }], assumptions: ['English only'] }, costUsd: 0.003 });
      }
      return fakeProvider().run(r);
    },
  });

  it('asks the person, stores answers as assumptions, and passes them to the planner and workers', async () => {
    const seen: string[] = [];
    const base = questionsProvider();
    const provider: ModelProvider = { id: base.id, run: (r) => { seen.push(r.prompt); return base.run(r); } };
    const { engine } = setup(provider);
    const t = engine.createTask('goal');
    const r = await engine.execute(t.id, { approver: yes, clarify: { mode: 'ask', ask: async () => ({ q1: 'EU' }) } });
    expect(r.task.status).toBe('done');
    expect(r.task.assumptions).toEqual(['Which region? EU', 'English only', 'Assumed English']);
    expect(seen.some((p) => p.includes('Already decided') && p.includes('Which region? EU'))).toBe(true);
    expect(readFileSync(r.resultPath!, 'utf8')).toContain('## Assumptions');
  });

  it('uses the default answers when the person gives none', async () => {
    const { engine } = setup(questionsProvider());
    const t = engine.createTask('goal');
    const r = await engine.execute(t.id, { approver: yes, clarify: { mode: 'defaults' } });
    expect(r.task.assumptions[0]).toBe('Which region? US (assumed)');
  });

  it('does not ask again when resumed, and skips cleanly when the clarifier fails', async () => {
    let clarifierCalls = 0;
    const failing: ModelProvider = {
      id: 'claude-code',
      async run(r) {
        if (r.jsonSchema && JSON.stringify(r.jsonSchema).includes('"questions"')) { clarifierCalls++; return ok({ ok: false, error: { kind: 'process', message: 'x' } }); }
        return fakeProvider().run(r);
      },
    };
    const { engine, store } = setup(failing);
    const t = engine.createTask('goal');
    const r = await engine.execute(t.id, { approver: yes, clarify: { mode: 'ask', ask: async () => null } });
    expect(r.task.status).toBe('done');
    expect(store.listEvents(t.id).map((e) => e.type)).toContain('clarify.skipped');
    await engine.execute(t.id, { clarify: { mode: 'ask' } });
    expect(clarifierCalls).toBe(1);
  });
});

describe('Engine memory', () => {
  const asking = (seen: string[]): ModelProvider => ({
    id: 'claude-code',
    async run(r) {
      seen.push(r.prompt);
      if (r.jsonSchema && JSON.stringify(r.jsonSchema).includes('"questions"')) {
        return ok({ json: { questions: [{ id: 'q1', text: 'Which region?', options: ['EU', 'US'], default: 'US' }], assumptions: [] } });
      }
      return fakeProvider().run(r);
    },
  });
  const run = async (engine: Engine, goal: string, answers: Record<string, string> | null) => {
    const t = engine.createTask(goal);
    return engine.execute(t.id, { approver: yes, clarify: { mode: 'ask', ask: async () => answers } });
  };

  it('remembers what the person answered, but never a default, and uses it for the next similar task', async () => {
    const seen: string[] = [];
    const { engine, store } = setup(asking(seen));
    await run(engine, 'Report on battery prices', { q1: 'EU' });
    await run(engine, 'Report on solar panel installers', null); // defaults only: nothing new to remember
    const mem = new MemoryStore(store);
    expect(mem.list().map((m) => m.text)).toEqual(['Which region? EU (earlier task: Report on battery prices)']);

    seen.length = 0;
    await run(engine, 'Another report on battery prices', { q1: 'EU' });
    const planner = seen.find((p) => p.includes('You are the planning agent'))!;
    expect(planner).toContain('Remembered from earlier tasks');
    expect(planner).toContain('Preference: Which region? EU (earlier task: Report on battery prices)');
    expect(planner).toContain('not facts');
    const clarifier = seen.find((p) => p.includes('help a person get exactly what they want'))!;
    expect(clarifier).toContain('Do not ask about anything they already answer');
    expect(mem.list()[0]!.uses).toBeGreaterThan(0);
  });

  it('remembers and uses nothing when memory is switched off', async () => {
    const seen: string[] = [];
    const home = mkdtempSync(join(tmpdir(), 'veritas-eng-'));
    homes.push(home);
    const store = Store.open(':memory:');
    new MemoryStore(store).add('preference', 'Which region? EU', 'k');
    const engine = new Engine({ store, provider: asking(seen), config: { ...defaultConfig(home), memoryEnabled: false }, retryDelayMs: 0 });
    await run(engine, 'Report on battery prices', { q1: 'US' });
    expect(new MemoryStore(store).count()).toBe(1);
    expect(seen.some((p) => p.includes('Remembered from earlier tasks'))).toBe(false);
  });
});
