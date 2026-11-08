import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase, schemaVersion } from '../../src/storage/db.js';
import { MIGRATIONS } from '../../src/storage/migrations.js';
import { dbPath, resolveHome, taskDir } from '../../src/storage/paths.js';
import { Store } from '../../src/storage/store.js';

const newTask = (store: Store, goal = 'Find three facts about the Moon') =>
  store.createTask({ slug: 'moon-facts', goal, type: 'general', budgetUsd: 2, mode: 'claude-code', cwd: '/tmp' });

describe('migrations', () => {
  it('sets the schema version and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    migrate(db);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('refuses a database from a newer version', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`);
    expect(() => migrate(db)).toThrow(/newer/);
  });

  it('creates a private database file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'veritas-db-'));
    const path = join(dir, 'sub', 'veritas.db');
    openDatabase(path).close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'sub')).mode & 0o777).toBe(0o700);
  });
});

describe('tasks', () => {
  it('creates a draft task and reads it back', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    expect(t.status).toBe('draft');
    expect(t.spentUsd).toBe(0);
    expect(t.assumptions).toEqual([]);
    expect(store.getTask(t.id)?.goal).toBe('Find three facts about the Moon');
  });

  it('finds tasks by id, id prefix and slug', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    expect(store.findTask(t.id)?.id).toBe(t.id);
    expect(store.findTask(t.id.slice(0, 10))?.id).toBe(t.id);
    expect(store.findTask('moon-facts')?.id).toBe(t.id);
    expect(store.findTask('nothing')).toBeUndefined();
  });

  it('treats LIKE wildcards in a reference literally', () => {
    const store = Store.open(':memory:');
    newTask(store);
    expect(store.findTask('%')).toBeUndefined();
    expect(store.findTask('_')).toBeUndefined();
  });

  it('reports an ambiguous prefix', () => {
    const store = Store.open(':memory:');
    newTask(store); newTask(store);
    expect(() => store.findTask('task_')).toThrow(/more than one/);
  });

  it('updates status, plan and assumptions', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    const plan = { subtasks: [], estimateUsd: { low: 0.1, high: 0.3 }, assumptions: ['a'] };
    const u = store.updateTask(t.id, { status: 'planned', plan, assumptions: ['x', 'y'] });
    expect(u.status).toBe('planned');
    expect(u.plan).toEqual(plan);
    expect(u.assumptions).toEqual(['x', 'y']);
    expect(store.updateTask(t.id, { error: null }).error).toBeNull();
  });

  it('accumulates spend', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    store.addSpent(t.id, 0.25);
    expect(store.addSpent(t.id, 0.5)).toBeCloseTo(0.75);
    expect(store.getTask(t.id)!.spentUsd).toBeCloseTo(0.75);
  });

  it('lists newest first', () => {
    const store = Store.open(':memory:');
    const a = newTask(store, 'a');
    const b = newTask(store, 'b');
    expect(store.listTasks().map((t) => t.id)).toEqual([b.id, a.id]);
  });
});

describe('subtasks', () => {
  it('creates ordered subtasks with dependencies and updates them', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    const subs = store.createSubtasks(t.id, [
      { key: 't1', title: 'First', kind: 'general', instructions: 'do 1', dependsOn: [] },
      { key: 't2', title: 'Second', kind: 'general', instructions: 'do 2', dependsOn: ['t1'] },
    ]);
    expect(subs.map((s) => s.key)).toEqual(['t1', 't2']);
    expect(subs[1]!.dependsOn).toEqual(['t1']);
    const u = store.updateSubtask(subs[0]!.id, { status: 'done', costUsd: 0.01, output: { text: 'hi' }, attempts: 1 });
    expect(u.status).toBe('done');
    expect(u.output).toEqual({ text: 'hi' });
    expect(u.costUsd).toBe(0.01);
  });

  it('rejects duplicate keys within a task and rolls everything back', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    expect(() => store.createSubtasks(t.id, [
      { key: 't1', title: 'A', kind: 'general', instructions: '', dependsOn: [] },
      { key: 't1', title: 'B', kind: 'general', instructions: '', dependsOn: [] },
    ])).toThrow();
    expect(store.listSubtasks(t.id)).toEqual([]);
  });

  it('deletes subtasks when the task is replanned', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    store.createSubtasks(t.id, [{ key: 't1', title: 'A', kind: 'general', instructions: '', dependsOn: [] }]);
    store.deleteSubtasks(t.id);
    expect(store.listSubtasks(t.id)).toEqual([]);
  });
});

describe('events', () => {
  it('appends in order and supports reading after an id', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    const e1 = store.appendEvent(t.id, 'task.created', { goal: 'x' });
    store.appendEvent(t.id, 'plan.created', { n: 2 });
    const e3 = store.appendEvent(t.id, 'task.finished');
    const all = store.listEvents(t.id);
    expect(all.map((e) => e.type)).toEqual(['task.created', 'plan.created', 'task.finished']);
    expect(all[0]!.data).toEqual({ goal: 'x' });
    expect(store.listEvents(t.id, e1.id).map((e) => e.type)).toEqual(['plan.created', 'task.finished']);
    expect(e3.id).toBeGreaterThan(e1.id);
  });
});

describe('approvals', () => {
  it('can be decided exactly once', () => {
    const store = Store.open(':memory:');
    const t = newTask(store);
    const a = store.createApproval(t.id, 'plan.start', { cost: 1 });
    expect(a.status).toBe('pending');
    expect(store.listApprovals(t.id, 'pending')).toHaveLength(1);
    const d = store.decideApproval(a.id, 'approved', 'user');
    expect(d?.status).toBe('approved');
    expect(d?.decidedBy).toBe('user');
    expect(store.decideApproval(a.id, 'denied', 'user')).toBeUndefined();
    expect(store.getApproval(a.id)!.status).toBe('approved');
  });
});

describe('transactions', () => {
  it('rolls back on error', () => {
    const store = Store.open(':memory:');
    expect(() => store.transaction(() => { newTask(store); throw new Error('boom'); })).toThrow('boom');
    expect(store.listTasks()).toHaveLength(0);
  });

  it('rolls back only the inner savepoint when the outer catches', () => {
    const store = Store.open(':memory:');
    store.transaction(() => {
      newTask(store, 'kept');
      try { store.transaction(() => { newTask(store, 'dropped'); throw new Error('inner'); }); } catch { /* expected */ }
    });
    expect(store.listTasks().map((t) => t.goal)).toEqual(['kept']);
  });
});

describe('paths', () => {
  it('honours VERITAS_HOME and falls back to ~/.veritas', () => {
    expect(resolveHome({ VERITAS_HOME: '/data/v' })).toBe('/data/v');
    expect(resolveHome({}).endsWith('/.veritas')).toBe(true);
    expect(dbPath('/h')).toBe('/h/veritas.db');
    expect(taskDir('/h', 'task_1')).toBe('/h/tasks/task_1');
  });
});
