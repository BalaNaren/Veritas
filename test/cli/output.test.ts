import { describe, expect, it } from 'vitest';
import { OutputFormatter } from '../../src/cli/output.js';

describe('OutputFormatter', () => {
  const plain = new OutputFormatter({ color: false });

  it('renders a table with headers and rows', () => {
    const text = plain.table({
      columns: [
        { key: 'name', header: 'Name' },
        { key: 'cost', header: 'Cost', align: 'right' },
      ],
      data: [
        { name: 'planner', cost: '$0.10' },
        { name: 'worker', cost: '$0.02' },
      ],
    });
    expect(text).toContain('Name');
    expect(text).toContain('planner');
    expect(text).toContain('$0.02');
  });

  it('renders a progress bar proportional to progress', () => {
    const half = plain.progressBar(5, 10, 10);
    expect(half.replace(/[^#]/g, '').length).toBe(5);
    expect(half).toContain('50.0%');
  });

  it('emits no colour codes when colour is disabled', () => {
    expect(plain.success('ok')).not.toMatch(/\u001b\[/);
  });

  it('emits colour codes when colour is enabled', () => {
    const colored = new OutputFormatter({ color: true });
    expect(colored.error('bad')).toMatch(/\u001b\[/);
  });

  it('serialises JSON with indentation', () => {
    expect(plain.json({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('boxes content with a title', () => {
    expect(plain.box('hello', 'Title')).toContain('Title');
  });
});
