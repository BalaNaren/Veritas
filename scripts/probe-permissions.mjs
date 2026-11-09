#!/usr/bin/env node
// Manual check of what file tools an agent can reach with Veritas's permission rules. Uses the real runtime
// (a few tenths of a cent). Run with: npm run probe:permissions
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeProvider } from '../dist/agents/claude-code.js';
import { scopeToFolder } from '../dist/agents/scope.js';

const provider = new ClaudeCodeProvider({ defaultTimeoutMs: 120_000 });
if (!provider.available) { console.error('Claude Code was not found.'); process.exit(1); }
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'veritas-probe-')));
const outside = join(tmpdir(), `veritas-probe-outside-${process.pid}.txt`);
const outsideExisting = join(tmpdir(), `veritas-probe-existing-${process.pid}.txt`);
writeFileSync(join(dir, 'a.txt'), 'hello inside');
writeFileSync(outsideExisting, 'original');

const run = async (label, allowed) => {
  const r = await provider.run({
    prompt: `Authorised permission test. Do each step with the file tools and report worked or denied, one line each:
1. Write ${outside} containing hi.
2. Edit ${outsideExisting} replacing "original" with "CHANGED" (read it first if needed).
3. Read /etc/hosts.
4. Glob /etc/host*.
5. Read a.txt here.
6. Write inside-ok.txt here containing ok.`,
    model: 'haiku', cwd: dir, tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'], allowedTools: allowed, timeoutMs: 120_000, maxBudgetUsd: 0.2,
  });
  const result = {
    wroteOutside: existsSync(outside), editedOutside: readFileSync(outsideExisting, 'utf8') !== 'original', wroteInside: existsSync(join(dir, 'inside-ok.txt')),
  };
  console.log(`\n== ${label}\n${JSON.stringify(allowed)}\n${r.ok ? r.text : r.error?.message}\n${JSON.stringify(result)}`);
  rmSync(outside, { force: true }); rmSync(join(dir, 'inside-ok.txt'), { force: true }); writeFileSync(outsideExisting, 'original');
  return result;
};

const bare = await run('Bare tool names (what NOT to do)', ['Read', 'Edit', 'Write', 'Grep', 'Glob']);
const scoped = await run('Scoped to the folder (what Veritas does)', scopeToFolder(['Read', 'Edit', 'Write', 'Grep', 'Glob'], dir));
rmSync(dir, { recursive: true, force: true }); rmSync(outsideExisting, { force: true });
console.log(`\nBare rules let the agent change files outside its folder: ${bare.wroteOutside || bare.editedOutside}`);
console.log(`Scoped rules let the agent change files outside its folder: ${scoped.wroteOutside || scoped.editedOutside}`);
console.log(`Scoped rules still let it work inside: ${scoped.wroteInside}`);
process.exit(scoped.wroteOutside || scoped.editedOutside || !scoped.wroteInside ? 1 : 0);
