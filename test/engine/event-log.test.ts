import { describe, expect, it } from 'vitest';
import { EventLog } from '../../src/engine/event-log.js';
import { Store } from '../../src/storage/store.js';

const setup = () => {
  const store = Store.open(':memory:');
  const a = store.createTask({ slug: 'a', goal: 'g', type: 'general', budgetUsd: 1, mode: 'local', cwd: '/' });
  const b = store.createTask({ slug: 'b', goal: 'g', type: 'general', budgetUsd: 1, mode: 'local', cwd: '/' });
  return { store, log: new EventLog(store), a, b };
};

describe('EventLog', () => {
  it('stores events and notifies listeners', () => {
    const { log, a } = setup();
    const seen: string[] = [];
    log.subscribe((e) => seen.push(e.type));
    log.emit(a.id, 'x');
    expect(seen).toEqual(['x']);
    expect(log.history(a.id).map((e) => e.type)).toEqual(['x']);
  });

  it('filters by task and can unsubscribe', () => {
    const { log, a, b } = setup();
    const seen: string[] = [];
    const off = log.subscribe((e) => seen.push(e.type), a.id);
    log.emit(b.id, 'other');
    log.emit(a.id, 'mine');
    off();
    log.emit(a.id, 'after');
    expect(seen).toEqual(['mine']);
  });

  it('survives a throwing listener', () => {
    const { log, a } = setup();
    log.subscribe(() => { throw new Error('boom'); });
    expect(() => log.emit(a.id, 'x')).not.toThrow();
    expect(log.history(a.id)).toHaveLength(1);
  });
});
