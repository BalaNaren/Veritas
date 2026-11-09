import { describe, expect, it } from 'vitest';
import { buildFrame, fit, LiveView, visibleLength, type LiveSnapshot } from '../../src/cli/live.js';
import { OutputFormatter } from '../../src/cli/output.js';

const plain = new OutputFormatter({ color: false });
const colour = new OutputFormatter({ color: true });
const base: LiveSnapshot = {
  taskId: 'task_cf175ab024dd46ea', goal: "Which region's revenue grew fastest between 2023 and 2024, and what was total revenue in each year?", status: 'running',
  budgetUsd: 2, spentUsd: 0.31, claims: null, sources: { fetched: 0, failed: 0 }, tests: [],
  subtasks: [
    { key: 't1', title: 'Regional revenue growth 2023 vs 2024', status: 'done', costUsd: 0.09, model: 'sonnet', attempts: 1 },
    { key: 't2', title: 'Yearly totals', status: 'running', costUsd: 0, model: 'sonnet', attempts: 1 },
    { key: 't3', title: 'Chart', status: 'pending', costUsd: 0, model: null, attempts: 0 },
  ],
};
const frame = (s: Partial<LiveSnapshot> = {}, o: Partial<Parameters<typeof buildFrame>[2]> = {}): string[] => buildFrame({ ...base, ...s }, plain, { width: 90, unicode: true, tick: 0, elapsedMs: 42_000, ...o });

describe('buildFrame', () => {
  it('shows the header, the goal, the phase pipeline, the tasks and the spending', () => {
    const f = frame();
    expect(f[0]).toContain('VERITAS');
    expect(f[0]).toContain('task_cf175ab024dd46ea');
    expect(f[0]).toContain('elapsed 0:42');
    expect(f[1]).toContain("Which region's revenue grew fastest");
    const pipeline = f.find((l) => l.includes('Plan') && l.includes('Work'))!;
    expect(pipeline).toContain('✓ Plan');
    expect(pipeline).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Work/);
    expect(pipeline).toContain('○ Check');
    expect(f.join('\n')).toContain('✓ t1');
    expect(f.join('\n')).toContain('$0.09');
    expect(f.join('\n')).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] t2/);
    expect(f.join('\n')).toContain('○ t3');
    const spent = f.find((l) => l.includes('Spent'))!;
    expect(spent).toContain('$0.31 of $2.00');
    expect(spent).toContain('16%');
    expect(spent).toContain('██░░░░░░░░░░░░░░░░░░░░░░'.slice(0, 4));
  });

  it('animates by tick and keeps every line inside the width', () => {
    expect(frame({}, { tick: 0 }).join('\n')).not.toBe(frame({}, { tick: 1 }).join('\n'));
    for (const width of [50, 60, 90, 200]) for (const line of frame({ goal: 'x'.repeat(400), subtasks: [{ ...base.subtasks[0]!, title: 'y'.repeat(300) }] }, { width })) {
      expect(line.length, `width ${width}: ${line}`).toBeLessThanOrEqual(Math.min(Math.max(width, 50), 110));
    }
  });

  it('shows claim, source and test counters when there is something to count', () => {
    const f = frame({ status: 'verifying', claims: { confirmed: 6, flagged: 2, removed: 1, pending: 3 }, sources: { fetched: 4, failed: 1 }, tests: [{ phase: 'before', passed: false }, { phase: 'round 1', passed: true }] }).join('\n');
    expect(f).toContain('✓ 6 confirmed');
    expect(f).toContain('⚠ 2 flagged');
    expect(f).toContain('✗ 1 removed');
    expect(f).toContain('3 to check');
    expect(f).toContain('4 read, 1 could not be fetched');
    expect(f).toContain('⚠ before');
    expect(f).toContain('✓ round 1');
    expect(f.match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Check/)).not.toBeNull();
  });

  it('marks failure, pause and completion without a spinner', () => {
    expect(frame({ status: 'done' }).find((l) => l.includes('Write'))).toContain('✓ Write');
    expect(frame({ status: 'failed' }).join('\n')).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    expect(frame({ status: 'failed', subtasks: [] }).find((l) => l.includes('Plan'))).toContain('✗ Plan');
    expect(frame({ status: 'failed', subtasks: [{ ...base.subtasks[0]!, status: 'done' }], claims: { confirmed: 1, flagged: 0, removed: 0, pending: 2 } }).find((l) => l.includes('Check'))).toContain('✗ Check');
    expect(frame({ status: 'cancelled' }).find((l) => l.includes('Work'))).toContain('✗ Work');
    expect(frame({ status: 'failed' }).find((l) => l.includes('Work'))).toContain('✗ Work');
    expect(frame({ status: 'paused' }).find((l) => l.includes('Work'))).toContain('○ Work');
  });

  it('turns red when the budget is used up, and falls back to plain characters without unicode', () => {
    const over = buildFrame({ ...base, spentUsd: 2.2 }, colour, { width: 90, unicode: true, tick: 0, elapsedMs: 0 }).find((l) => l.includes('Spent'))!;
    expect(over).toContain('\x1b[31m');
    expect(over).toContain('100%');
    const ascii = frame({ claims: { confirmed: 1, flagged: 1, removed: 1, pending: 0 } }, { unicode: false }).join('\n');
    expect(ascii).not.toMatch(/[^\x00-\x7f]/);
    expect(ascii).toContain('v 1 confirmed');
    expect(ascii).toContain('#'.repeat(1));
  });

  it('is pure: the same input gives the same frame', () => {
    expect(frame()).toEqual(frame());
  });
});

describe('fit', () => {
  it('cuts by visible characters, keeps colour codes intact, and closes the colour', () => {
    const line = '\x1b[32mhello\x1b[0m world';
    expect(visibleLength(line)).toBe(11);
    expect(fit(line, 20)).toBe(line);
    const cut = fit(line, 7);
    expect(visibleLength(cut)).toBe(7);
    expect(cut.startsWith('\x1b[32mhello\x1b[0m')).toBe(true);
    expect(cut.endsWith('\x1b[0m')).toBe(true);
    expect(fit('a'.repeat(100), 10)).toBe('a'.repeat(10) + '\x1b[0m');
  });
});

describe('LiveView', () => {
  function stream(isTTY = true) {
    const writes: string[] = [];
    return { writes, isTTY, columns: 80, write: (t: string) => { writes.push(t); return true; } };
  }

  it('draws only on a terminal', () => {
    expect(LiveView.supported({ write: () => true, isTTY: true })).toBe(true);
    expect(LiveView.supported({ write: () => true, isTTY: false })).toBe(false);
    expect(LiveView.supported({ write: () => true })).toBe(false);
  });

  it('hides the cursor, redraws in place by moving up exactly the height of the last frame, and restores the cursor', () => {
    const s = stream();
    let status: LiveSnapshot['status'] = 'running';
    const view = new LiveView({ stream: s, fmt: plain, snapshot: () => ({ ...base, status }), intervalMs: 0, now: () => 1000 });
    view.start();
    expect(s.writes[0]).toBe('\x1b[?25l');
    const height = s.writes[1]!.trimEnd().split('\n').length;
    expect(s.writes[1]!.startsWith('\r\x1b[J')).toBe(true);   // first frame: nothing to move over
    view.render();
    expect(s.writes[2]!.startsWith(`\x1b[${height}A\r\x1b[J`)).toBe(true);
    status = 'done';
    view.stop();
    expect(s.writes.at(-1)).toBe('\x1b[?25h');
    expect(s.writes.at(-2)).toContain('✓ Work');
    const before = s.writes.length;
    view.render();                                              // after stop nothing is drawn
    expect(s.writes.length).toBe(before);
  });

  it('pauses so a question can be asked below the panel, then continues with a fresh panel below it', () => {
    const s = stream();
    const view = new LiveView({ stream: s, fmt: plain, snapshot: () => base, intervalMs: 0, now: () => 5000 });
    view.start();
    view.pause();
    expect(s.writes.at(-1)).toBe('\x1b[?25h');
    const afterPause = s.writes.length;
    view.render();
    expect(s.writes.length).toBe(afterPause);
    view.resume();
    expect(s.writes[afterPause]).toBe('\x1b[?25l');
    expect(s.writes[afterPause + 1]!.startsWith('\r\x1b[J')).toBe(true);   // does not move up over the question that was asked
  });

  it('counts elapsed time across a pause', () => {
    const s = stream();
    let t = 0;
    const view = new LiveView({ stream: s, fmt: plain, snapshot: () => base, intervalMs: 0, now: () => t });
    view.start();
    t = 30_000; view.pause();
    t = 90_000; view.resume();
    t = 100_000; view.render();
    expect(s.writes.at(-1)).toContain('elapsed 0:40');
  });

  it('stops animating on its own timer and gives the terminal back even if stopped twice', async () => {
    const s = stream();
    const view = new LiveView({ stream: s, fmt: plain, snapshot: () => base, intervalMs: 10 });
    view.start();
    await new Promise((r) => setTimeout(r, 60));
    view.stop();
    view.stop();
    const n = s.writes.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(s.writes.length).toBe(n);
    expect(s.writes.filter((w) => w === '\x1b[?25h')).toHaveLength(1);
    expect(s.writes.length).toBeGreaterThan(4);
  });
});
