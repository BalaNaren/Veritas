import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from '../../src/agents/claude-code.js';
import type { ClaudeProbe, Runtime } from '../../src/cli/app.js';
import { main } from '../../src/cli/main.js';
import { OutputFormatter } from '../../src/cli/output.js';
import { EvidenceStore } from '../../src/evidence/evidence-store.js';
import { ensureHome, dbPath } from '../../src/storage/paths.js';
import { Store } from '../../src/storage/store.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-claude.mjs');
const homes: string[] = [];
afterEach(() => { while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true }); });

let setupCalls = 0;
function harness(opts: { interactive?: boolean; answers?: string[]; probe?: ClaudeProbe; home?: string } = {}) {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'veritas-cli-'));
  if (!opts.home) homes.push(home);
  let stdout = '';
  let stderr = '';
  const answers = [...(opts.answers ?? [])];
  const asked: string[] = [];
  const rt: Runtime = {
    out: new OutputFormatter({ color: false, stdout: { write: (t) => (stdout += t) }, stderr: { write: (t) => (stderr += t) } }),
    env: { VERITAS_HOME: home }, cwd: process.cwd(),
    interactive: opts.interactive ?? false,
    async ask(q) { asked.push(q); return answers.shift() ?? ''; },
    makeProvider: () => new ClaudeCodeProvider({ binary: FAKE, defaultTimeoutMs: 15_000 }),
    probeClaude: async () => opts.probe ?? { found: true, path: '/x/claude', version: '9', loggedIn: true, detail: 'logged in (test)' },
    setupRuntime: async () => { setupCalls++; },
    onInterrupt: () => () => {},
    retryDelayMs: 0,
  };
  return { home, rt, asked, run: (...argv: string[]) => main(argv, rt), out: () => stdout, err: () => stderr };
}
const idOf = (text: string): string => text.match(/task_[0-9a-f]{16}/)![0];
const GOAL = '[[fake:plan]] research tides';

describe('veritas CLI', () => {
  it('shows help and the version', async () => {
    const h = harness();
    expect(await h.run('--help')).toBe(0);
    expect(h.out()).toContain('veritas run');
    expect(await h.run('--version')).toBe(0);
    expect(await h.run('run', '--help')).toBe(0);
    expect(h.out()).toContain('--budget');
  });

  it('rejects unknown commands and options with exit code 2', async () => {
    const h = harness();
    expect(await h.run('bogus')).toBe(2);
    expect(h.err()).toMatch(/Unknown command/);
    expect(await h.run('list', '--nonsense')).toBe(2);
  });

  it('asks for a goal and validates the budget', async () => {
    const h = harness();
    expect(await h.run('run')).toBe(1);
    expect(h.err()).toMatch(/Describe the goal/);
    expect(await h.run('run', 'x', '--budget', '-1')).toBe(1);
  });

  it('runs end to end when the plan is pre-approved with --yes-plan', async () => {
    const h = harness();
    expect(await h.run('run', GOAL, '--yes-plan', '--budget', '3')).toBe(0);
    expect(h.out()).toMatch(/Done\./);
    const id = idOf(h.out());
    expect(existsSync(join(h.home, 'tasks', id, 'result.md'))).toBe(true);
    expect(await h.run('list')).toBe(0);
    expect(h.out()).toContain(id);
  });

  it('plans without running, then runs after `approve`', async () => {
    const h = harness();
    expect(await h.run('plan', GOAL)).toBe(3);
    expect(h.out()).toContain('Nothing has run yet');
    const id = idOf(h.out());
    expect(await h.run('status')).toBe(0);
    expect(await h.run('approve', id)).toBe(0);
    expect(h.out()).toMatch(/Approved: plan\.start/);
    expect(h.out()).toMatch(/Done\./);
    expect(await h.run('approve', id)).toBe(0);
    expect(h.out()).toMatch(/Nothing is waiting/);
  });

  it('asks the person in interactive mode and honours each answer', async () => {
    const yes = harness({ interactive: true, answers: ['y'] });
    expect(await yes.run('run', GOAL)).toBe(0);
    expect(yes.asked[0]).toMatch(/Run this plan/);

    const no = harness({ interactive: true, answers: ['n'] });
    expect(await no.run('run', GOAL)).toBe(3);
    expect(no.out()).toMatch(/Cancelled/);

    const later = harness({ interactive: true, answers: ['l'] });
    expect(await later.run('run', GOAL)).toBe(3);
    expect(later.out()).toMatch(/veritas approve/);
  });

  it('refuses an approval from `approve --deny`', async () => {
    const h = harness();
    await h.run('plan', GOAL);
    const id = idOf(h.out());
    expect(await h.run('approve', id, '--deny')).toBe(0);
    expect(await h.run('show', id, '--json')).toBe(0);
    expect(JSON.parse(h.out().slice(h.out().lastIndexOf('\n{\n') + 1)).task.status).toBe('cancelled');
  });

  it('cancels a task', async () => {
    const h = harness();
    await h.run('plan', GOAL);
    const id = idOf(h.out());
    expect(await h.run('cancel', id)).toBe(0);
    expect(h.out()).toContain(`Cancelled ${id}`);
    expect(await h.run('cancel', 'task_missing')).toBe(1);
  });

  it('shows a task and the cost report', async () => {
    const h = harness();
    await h.run('run', GOAL, '--yes-plan');
    const id = idOf(h.out());
    expect(await h.run('show', id, '--outputs', '--events')).toBe(0);
    expect(h.out()).toContain('task.done');
    expect(await h.run('cost')).toBe(0);
    expect(h.out()).toMatch(/Total spent: \$0\.\d+/);
    expect(await h.run('cost', '--days', '0')).toBe(1);
  });

  it('reads and changes settings, persisting them', async () => {
    const h = harness();
    expect(await h.run('config', 'set', 'maxConcurrent', '2')).toBe(0);
    expect(await harness({ home: h.home }).run('config', 'get', 'maxConcurrent')).toBe(0);
    const h2 = harness({ home: h.home });
    await h2.run('config', 'get', 'maxConcurrent');
    expect(h2.out().trim()).toBe('2');
    expect(await h2.run('config', 'set', 'maxConcurrent', 'abc')).toBe(1);
    expect(await h2.run('config', 'set', 'homeDir', '/x')).toBe(1);
  });

  it('reports problems in doctor', async () => {
    const bad = harness({ probe: { found: false, detail: 'Claude Code was not found.' } });
    expect(await bad.run('doctor')).toBe(1);
    expect(bad.out()).toMatch(/problem/);
    const notLoggedIn = harness({ probe: { found: true, loggedIn: false, detail: 'Not logged in.' } });
    expect(await notLoggedIn.run('doctor')).toBe(1);
    expect(await harness().run('doctor')).toBe(0);
  });

  it('asks clarifying questions interactively and records the answers', async () => {
    const h = harness({ interactive: true, answers: ['2', '', 'y'] });
    expect(await h.run('run', '[[fake:ask]] tides')).toBe(0);
    expect(h.asked[0]).toContain('[Global]');
    expect(h.out()).toContain('A few questions');
    expect(h.out()).toContain('Which region? Europe');
    expect(h.out()).toContain('How deep? Overview');
  });

  it('skips questions with --quick, and only uses defaults unattended with --clarify', async () => {
    const q = harness({ interactive: true, answers: ['y'] });
    expect(await q.run('run', '[[fake:ask]] tides', '--quick')).toBe(0);
    expect(q.out()).not.toContain('A few questions');
    const u = harness();
    expect(await u.run('run', '[[fake:ask]] tides', '--yes-plan', '--clarify')).toBe(0);
    expect(u.out()).toContain('Which region? Global (assumed)');
  });

  it('lists claims and shows one in full', async () => {
    const h = harness();
    ensureHome(h.home);
    const store = Store.open(dbPath(h.home));
    const task = store.createTask({ slug: 't', goal: 'g', type: 'research', budgetUsd: 1, mode: 'x', cwd: '/' });
    const ev = new EvidenceStore(store, h.home);
    const src = ev.addSource({ taskId: task.id, url: 'https://www.nasa.gov/a', finalUrl: 'https://www.nasa.gov/a', contentType: 'text/html', bytes: 1, sha256: 'x', fetchedAt: '2026-01-01T00:00:00Z', text: 'The Moon is far away from us.' });
    const c = ev.addClaim({ taskId: task.id, text: 'The Moon is far away.', type: 'fact', url: src.url, quote: 'The Moon is far away from us.', important: true });
    ev.updateClaim(c.id, { status: 'confirmed', sourceId: src.id, checks: [{ step: 'quote_matches', passed: true, detail: 'Found it' }] });
    store.close();

    expect(await h.run('show', task.id, '--claims')).toBe(0);
    expect(h.out()).toContain('confirmed');
    expect(h.out()).toContain('The Moon is far away.');
    expect(await h.run('show', task.id, '--claim', '1')).toBe(0);
    expect(h.out()).toContain('Claim 1 [confirmed] (important)');
    expect(h.out()).toContain('Quote:   The Moon is far away from us.');
    expect(h.out()).toContain('quote_matches: Found it');
    expect(await h.run('show', task.id, '--claim', '9')).toBe(1);
    expect(h.err()).toContain('no claim 9');
  });

  it('exports a finished report and refuses unfinished ones', async () => {
    const h = harness();
    expect(await h.run('run', GOAL, '--yes-plan')).toBe(0);
    const id = idOf(h.out());
    expect(await h.run('export', id, '--as', 'docx')).toBe(0);
    expect(existsSync(join(h.home, 'tasks', id, 'result.docx'))).toBe(true);
    const target = join(h.home, 'out.pdf');
    expect(await h.run('export', id, '--as', 'pdf', '--out', target)).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(await h.run('export', id, '--as', 'rtf')).toBe(2);

    const p = harness({ home: h.home });
    await p.run('plan', GOAL);
    expect(await p.run('export', idOf(p.out()))).toBe(1);
    expect(p.err()).toMatch(/no finished report/);
  });

  it('checks --file arguments before creating a task', async () => {
    const h = harness();
    expect(await h.run('run', 'summarise', '--file', join(h.home, 'nope.pdf'))).toBe(1);
    expect(h.err()).toMatch(/Cannot find/);
    writeFileSync(join(h.home, 'pic.png'), 'x');
    expect(await h.run('run', 'summarise', '--file', join(h.home, 'pic.png'))).toBe(1);
    expect(h.err()).toMatch(/not supported/);
    expect(await h.run('run', 'summarise', '--file', h.home)).toBe(1); // a folder with no supported files
    expect(h.err()).toMatch(/no supported files/);
    expect(await h.run('list')).toBe(0);
    expect(h.out()).toContain('No tasks yet');
  });

  it('asks before setting up the sandbox, and installs nothing when declined', async () => {
    setupCalls = 0;
    const no = harness({ interactive: true, answers: ['n'] });
    expect(await no.run('setup')).toBe(0);
    expect(no.out()).toContain('no network access');
    expect(no.out()).toContain('Nothing was installed');
    expect(setupCalls).toBe(0);
    const unattended = harness();
    expect(await unattended.run('setup')).toBe(1);
    expect(unattended.err()).toMatch(/terminal, or pass --yes/);
    expect(setupCalls).toBe(0);
    const yes = harness();
    await yes.run('setup', '--yes');
    expect(setupCalls).toBe(1);
  });

  it('mentions the sandbox in doctor without treating a missing one as a failure', async () => {
    const h = harness();
    expect(await h.run('doctor')).toBe(0);
    expect(h.out()).toContain('Analysis sandbox');
  });
});
