import { describe, expect, it } from 'vitest';
import { CommandParser } from '../../src/cli/parser.js';
import type { Command } from '../../src/cli/types.js';

function makeParser() {
  const parser = new CommandParser({ allowUnknownFlags: true });
  const run: Command = {
    name: 'run',
    description: 'Run a task',
    options: [
      { name: 'budget', short: 'b', description: 'Budget', type: 'number' },
      { name: 'yes-plan', description: 'Approve plan', type: 'boolean' },
      { name: 'reward', description: 'Reward', type: 'number' },
    ],
  };
  const memory: Command = {
    name: 'memory',
    description: 'Memory',
    subcommands: [{ name: 'list', description: 'List', options: [{ name: 'limit', description: 'n', type: 'number' }] }],
  };
  parser.registerCommand(run);
  parser.registerCommand(memory);
  return parser;
}

describe('CommandParser', () => {
  it('resolves a command and keeps the goal as a positional', () => {
    const r = makeParser().parse(['run', 'research the moon']);
    expect(r.command).toEqual(['run']);
    expect(r.positional).toEqual(['research the moon']);
  });

  it('resolves subcommands', () => {
    const r = makeParser().parse(['memory', 'list', '--limit', '5']);
    expect(r.command).toEqual(['memory', 'list']);
    expect(r.flags.limit).toBe(5);
  });

  it('parses --flag=value and --flag value', () => {
    const p = makeParser();
    expect(p.parse(['run', 'x', '--budget=2.5']).flags.budget).toBe(2.5);
    expect(p.parse(['run', 'x', '--budget', '3']).flags.budget).toBe(3);
  });

  it('accepts a short alias scoped to the command', () => {
    expect(makeParser().parse(['run', 'x', '-b', '4']).flags.budget).toBe(4);
  });

  it('treats a negative number as a value, not a flag', () => {
    const r = makeParser().parse(['run', 'x', '--reward', '-1.0']);
    expect(r.flags.reward).toBe(-1);
  });

  it('normalises kebab-case flag names to camelCase', () => {
    expect(makeParser().parse(['run', 'x', '--yes-plan']).flags.yesPlan).toBe(true);
  });

  it('supports --no-<flag> negation', () => {
    expect(makeParser().parse(['run', 'x', '--no-yes-plan']).flags.yesPlan).toBe(false);
  });

  it('does not consume a positional after a boolean flag', () => {
    const r = makeParser().parse(['run', '--yes-plan', 'my goal']);
    expect(r.flags.yesPlan).toBe(true);
    expect(r.positional).toEqual(['my goal']);
  });

  it('applies global defaults', () => {
    const r = makeParser().parse(['run', 'x']);
    expect(r.flags.format).toBe('text');
  });

  it('leaves unknown commands unresolved', () => {
    const r = makeParser().parse(['nope']);
    expect(r.command).toEqual([]);
    expect(r.positional).toContain('nope');
  });
});

describe('array flags', () => {
  it('collects every value of a repeated flag', () => {
    const p = new CommandParser({ allowUnknownFlags: false, arrayFlags: ['file'] });
    p.registerCommand({ name: 'run', description: 'r', options: [{ name: 'file', type: 'array', description: 'f' }] });
    expect(p.parse(['run', 'goal', '--file', 'a.pdf', '--file', 'b.pdf']).flags.file).toEqual(['a.pdf', 'b.pdf']);
    expect(p.parse(['run', '--file=a.pdf', 'goal']).flags.file).toEqual(['a.pdf']);
    expect(p.parse(['run', 'goal']).positional).toEqual(['goal']);
  });
});
