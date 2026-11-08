import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from '../../src/agents/claude-code.js';
import { Budget } from '../../src/cost/budget.js';
import { defaultConfig } from '../../src/config.js';
import { EventLog } from '../../src/engine/event-log.js';
import { runSubtasks } from '../../src/engine/scheduler.js';
import { Store, type NewSubtask } from '../../src/storage/store.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-claude.mjs');
const provider = new ClaudeCodeProvider({ binary: FAKE, defaultTimeoutMs: 15_000 });
const st = (key: string, instructions = 'work', dependsOn: string[] = []): NewSubtask => ({ key, title: key, kind: 'general', instructions, dependsOn });

function setup(items: NewSubtask[], limit = 5) {
  const store = Store.open(':memory:');
  const task = store.createTask({ slug: 't', goal: 'the goal', type: 'general', budgetUsd: limit, mode: 'claude-code', cwd: process.cwd() });
  store.createSubtasks(task.id, items);
  const events = new EventLog(store);
  const budget = new Budget(limit);
  const config = { ...defaultConfig('/tmp/x'), maxConcurrent: 2 };
  const run = (extra: Record<string, unknown> = {}) =>
    runSubtasks({ store, events, provider, budget, config, task, retryDelayMs: 0, ...extra });
  const subs = () => Object.fromEntries(store.listSubtasks(task.id).map((s) => [s.key, s]));
  const types = () => events.history(task.id).map((e) => e.type);
  return { store, task, run, subs, types, budget };
}

describe('runSubtasks', () => {
  it('runs tasks in dependency order and passes results along', async () => {
    const t = setup([st('a'), st('b'), st('c', 'combine', ['a', 'b'])]);
    expect(await t.run()).toEqual({ status: 'done' });
    const s = t.subs();
    expect(Object.values(s).every((x) => x.status === 'done')).toBe(true);
    expect(String(s.c!.output)).toContain('echo:');
    expect(t.store.getTask(t.task.id)!.spentUsd).toBeCloseTo(0.03);
    expect(t.budget.spent).toBeCloseTo(0.03);
    expect(t.types().filter((x) => x === 'subtask.finished')).toHaveLength(3);
  });

  it('skips tasks downstream of a failure and reports failure', async () => {
    const t = setup([st('a', '[[fake:error]]'), st('b', 'ok', ['a']), st('c', 'ok')]);
    const r = await t.run({ maxAttempts: 1 });
    expect(r.status).toBe('failed');
    const s = t.subs();
    expect(s.a!.status).toBe('failed');
    expect(s.b!.status).toBe('skipped');
    expect(s.c!.status).toBe('done');
    expect(t.types()).toContain('subtask.skipped');
  });

  it('retries a failing task once before giving up', async () => {
    const t = setup([st('a', '[[fake:error]]')]);
    await t.run();
    expect(t.subs().a!.attempts).toBe(2);
    expect(t.types()).toContain('subtask.retry');
  });

  it('pauses when the budget cannot cover another agent', async () => {
    const t = setup([st('a', '[[fake:cost:0.5]]'), st('b', 'x', ['a'])], 0.5);
    const r = await t.run();
    expect(r).toEqual({ status: 'paused', reason: 'budget' });
    expect(t.subs().a!.status).toBe('done');
    expect(t.subs().b!.status).toBe('pending');
    expect(t.types()).toContain('budget.exceeded');
  });

  it('resumes after the limit is raised, keeping finished work', async () => {
    const t = setup([st('a', '[[fake:cost:0.5]]'), st('b', 'x', ['a'])], 0.5);
    await t.run();
    t.budget.setLimit(2);
    expect(await t.run()).toEqual({ status: 'done' });
    expect(t.subs().a!.attempts).toBe(1);
  });

  it('cancels running agents and leaves them resumable', async () => {
    const t = setup([st('a', '[[fake:sleep]]')]);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    expect(await t.run({ signal: ac.signal })).toEqual({ status: 'cancelled' });
    expect(t.subs().a!.status).toBe('pending');
    expect(t.budget.reserved).toBe(0);
  });

  it('puts tasks left running by a crash back to pending and runs them', async () => {
    const t = setup([st('a')]);
    t.store.updateSubtask(t.subs().a!.id, { status: 'running' });
    expect(await t.run()).toEqual({ status: 'done' });
  });
});
