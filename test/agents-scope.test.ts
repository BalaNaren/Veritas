import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArgs } from '../src/agents/claude-code.js';
import { ScopeError, scopeToFolder } from '../src/agents/scope.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const make = (name = 'work'): string => { const d = mkdtempSync(join(tmpdir(), 'veritas-scope-')); dirs.push(d); const p = join(d, name); mkdirSync(p); return p; };

describe('scopeToFolder', () => {
  it('limits every file tool to the folder using an absolute-path rule, and leaves other tools alone', () => {
    const folder = make();
    const real = realpathSync(folder);
    const rules = scopeToFolder(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash(npm test)', 'WebFetch'], folder);
    expect(rules).toEqual([`Read(//${real.slice(1)}/**)`, `Edit(//${real.slice(1)}/**)`, `Write(//${real.slice(1)}/**)`, `Grep(//${real.slice(1)}/**)`, `Glob(//${real.slice(1)}/**)`, 'Bash(npm test)', 'WebFetch']);
    expect(rules.every((r) => r !== 'Read' && r !== 'Write' && r !== 'Edit')).toBe(true);
  });
  it('uses the real path, so a link into the folder cannot widen the rule', () => {
    const folder = make();
    expect(scopeToFolder(['Write'], folder)[0]).toContain(realpathSync(folder).slice(1));
  });
  it.each(['we*ird', 'br[ack]et', 'pa(ren)', 'hash#tag', 'ba!ng', 'ünï'])('refuses a folder whose name could change the meaning of the rule: %s', (name) => {
    expect(() => scopeToFolder(['Write'], make(name))).toThrow(ScopeError);
  });
  it('produces tool arguments the launcher accepts', () => {
    const rules = scopeToFolder(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash(node --test)'], make());
    const args = buildArgs({ prompt: 'x', model: 'sonnet', cwd: '/', tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'], allowedTools: rules });
    expect(args[args.indexOf('--allowed-tools') + 1]).toBe(rules.join(','));
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Edit,Write,Grep,Glob,Bash');
  });
});
