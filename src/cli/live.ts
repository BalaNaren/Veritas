import { formatUsd } from '../cost/estimate.js';
import type { SubtaskStatus, TaskStatus } from '../storage/models.js';
import type { OutputFormatter } from './output.js';

/** Everything the live view shows, read from Veritas's own records so it always matches what was recorded. */
export interface LiveSnapshot {
  taskId: string;
  goal: string;
  status: TaskStatus;
  budgetUsd: number;
  spentUsd: number;
  subtasks: { key: string; title: string; status: SubtaskStatus; costUsd: number; model: string | null; attempts: number }[];
  /** Null until the task has claims to check. */
  claims: { confirmed: number; flagged: number; removed: number; pending: number } | null;
  sources: { fetched: number; failed: number };
  tests: { phase: string; passed: boolean }[];
  /** The most recent thing that happened, in words. */
  last?: string;
}

export interface FrameOptions {
  width: number;
  unicode: boolean;
  /** Animation step (any integer that grows). */
  tick: number;
  elapsedMs: number;
}

const SPIN_UNICODE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPIN_ASCII = ['|', '/', '-', '\\'];

/** The steps a task moves through, and which one each status belongs to. */
const PHASES = ['Plan', 'Work', 'Check', 'Write'] as const;
function phaseIndex(status: TaskStatus, s?: LiveSnapshot): number {
  switch (status) {
    case 'draft': case 'clarifying': case 'planned': case 'awaiting_approval': return 0;
    case 'running': case 'paused': return 1;
    case 'verifying': return 2;
    case 'writing': return 3;
    case 'done': return 4;
    default: {
      // Failed or cancelled: show the step it stopped in, judged from what was recorded.
      if (!s || !s.subtasks.length) return 0;
      if (s.subtasks.some((t) => t.status !== 'done')) return 1;
      return s.claims && s.claims.pending === 0 ? 3 : 2;
    }
  }
}

let ellipsis = '…';
const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - ellipsis.length))}${ellipsis}`;
};

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const visibleLength = (s: string): number => s.replace(ANSI, '').length;

/** Cut a line (which may contain colour codes) to a number of visible characters, so it can never wrap. */
export function fit(line: string, width: number): string {
  if (visibleLength(line) <= width) return line;
  let out = '';
  let seen = 0;
  for (let i = 0; i < line.length;) {
    ANSI.lastIndex = 0;
    const m = ANSI.exec(line.slice(i));
    if (m && m.index === 0) { out += m[0]; i += m[0].length; continue; }
    if (seen >= width) break;
    out += line[i]; seen++; i++;
  }
  return `${out}\x1b[0m`;
}
const pad = (text: string, n: number): string => (text.length >= n ? text : text + ' '.repeat(n - text.length));
const clock = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/** One frame of the live view as lines of text. Pure: the same input always gives the same frame. */
export function buildFrame(s: LiveSnapshot, fmt: OutputFormatter, o: FrameOptions): string[] {
  const w = Math.max(50, Math.min(o.width, 110));
  ellipsis = o.unicode ? '…' : '...';
  const spin = (o.unicode ? SPIN_UNICODE : SPIN_ASCII)[o.tick % (o.unicode ? SPIN_UNICODE.length : SPIN_ASCII.length)]!;
  const tick = o.unicode ? '✓' : 'v';
  const warn = o.unicode ? '⚠' : '!';
  const cross = o.unicode ? '✗' : 'x';
  const idle = o.unicode ? '○' : '.';
  const live = !['done', 'failed', 'cancelled', 'paused', 'awaiting_approval'].includes(s.status);
  const lines: string[] = [];

  // Header
  const brand = fmt.color(' VERITAS ', 'bold', 'cyan');
  const id = fmt.dim(clip(s.taskId, 28));
  const time = fmt.dim(`elapsed ${clock(o.elapsedMs)}`);
  const left = ` VERITAS   ${clip(s.taskId, 28)}`;
  const gap = Math.max(1, w - left.length - `elapsed ${clock(o.elapsedMs)}`.length - 1);
  lines.push(`${brand}  ${id}${' '.repeat(gap)}${time}`);
  lines.push(fmt.bold(clip(s.goal, w - 2)));
  lines.push('');

  // Phase pipeline
  const at = phaseIndex(s.status, s);
  const failed = s.status === 'failed' || s.status === 'cancelled';
  const steps = PHASES.map((name, i) => {
    if (i < at) return fmt.success(`${tick} ${name}`);
    if (i === at && live) return fmt.color(`${spin} ${name}`, 'cyan', 'bold');
    if (i === at) return failed ? fmt.error(`${cross} ${name}`) : fmt.warning(`${idle} ${name}`);
    return fmt.dim(`${idle} ${name}`);
  });
  lines.push(` ${steps.join(fmt.dim(o.unicode ? '  ──  ' : '  --  '))}`);
  lines.push('');

  // Tasks
  if (s.subtasks.length) {
    lines.push(fmt.dim(' Tasks'));
    const titleW = Math.max(16, w - 40);
    for (const t of s.subtasks) {
      const mark = t.status === 'done' ? fmt.success(tick) : t.status === 'failed' ? fmt.error(cross) : t.status === 'skipped' ? fmt.warning(warn)
        : t.status === 'running' && live ? fmt.color(spin, 'cyan', 'bold') : fmt.dim(idle);
      const cost = t.costUsd > 0 ? formatUsd(t.costUsd) : '';
      const tries = t.attempts > 1 ? ` ${t.attempts} tries` : '';
      lines.push(`  ${mark} ${fmt.bold(pad(clip(t.key, 6), 6))} ${pad(clip(t.title, titleW), titleW)} ${fmt.dim(pad(t.model ?? '', 7))} ${pad(cost, 7)}${fmt.dim(tries)}`);
    }
    lines.push('');
  }

  // Claims and sources (research, documents, data)
  if (s.claims) {
    const c = s.claims;
    const parts = [fmt.success(`${tick} ${c.confirmed} confirmed`), fmt.warning(`${warn} ${c.flagged} flagged`), fmt.error(`${cross} ${c.removed} removed`)];
    if (c.pending) parts.push(fmt.dim(`${c.pending} to check`));
    lines.push(` ${fmt.dim('Claims ')} ${parts.join('   ')}`);
  }
  if (s.sources.fetched || s.sources.failed) {
    lines.push(` ${fmt.dim('Sources')} ${s.sources.fetched} read${s.sources.failed ? fmt.warning(`, ${s.sources.failed} could not be fetched`) : ''}`);
  }
  if (s.tests.length) {
    lines.push(` ${fmt.dim('Tests  ')} ${s.tests.map((t) => (t.passed ? fmt.success(`${tick} ${t.phase}`) : fmt.warning(`${warn} ${t.phase}`))).join('   ')}`);
  }
  if (s.claims || s.sources.fetched || s.sources.failed || s.tests.length) lines.push('');

  // Spending
  const share = s.budgetUsd > 0 ? Math.min(1, s.spentUsd / s.budgetUsd) : 0;
  const label = `${formatUsd(s.spentUsd)} of ${formatUsd(s.budgetUsd)}`;
  const cells = Math.max(6, Math.min(24, w - label.length - 16));
  const filled = Math.round(share * cells);
  const bar = (o.unicode ? '█'.repeat(filled) + '░'.repeat(cells - filled) : '#'.repeat(filled) + '-'.repeat(cells - filled));
  const barColour = share >= 1 ? fmt.error(bar) : share > 0.8 ? fmt.warning(bar) : fmt.color(bar, 'cyan');
  lines.push(` ${fmt.dim('Spent')} ${label}  ${barColour} ${Math.round(share * 100)}%`);
  if (s.last) lines.push(` ${fmt.dim(clip(s.last, w - 2))}`);
  // Every line is held to the width: a line that wrapped would make the in-place redraw move up the wrong number of lines.
  return lines.map((l) => fit(l, w));
}

export interface LiveStream {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export interface LiveViewOptions {
  stream: LiveStream;
  fmt: OutputFormatter;
  snapshot: () => LiveSnapshot;
  /** Frame rate in milliseconds. 0 disables the timer (tests redraw by hand). */
  intervalMs?: number;
  unicode?: boolean;
  now?: () => number;
}

const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

/**
 * A panel that redraws itself in place while a task runs. It only draws on a terminal; on a pipe or a file
 * nothing is drawn, and the plain line-by-line progress is used instead.
 */
export class LiveView {
  private lastLines = 0;
  private timer?: ReturnType<typeof setInterval>;
  private tickCount = 0;
  private started = 0;
  private running = false;
  private elapsedBefore = 0;

  constructor(private readonly o: LiveViewOptions) {}

  static supported(stream: LiveStream): boolean {
    return stream.isTTY === true;
  }

  private now(): number { return (this.o.now ?? Date.now)(); }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.started = this.now();
    this.o.stream.write(HIDE);
    this.render();
    if ((this.o.intervalMs ?? 100) > 0) {
      this.timer = setInterval(() => this.render(), this.o.intervalMs ?? 100);
      this.timer.unref?.();
    }
  }

  /** Redraw now. Called by the timer, and whenever something happens. */
  render(): void {
    if (!this.running) return;
    this.tickCount++;
    const lines = buildFrame(this.o.snapshot(), this.o.fmt, {
      width: this.o.stream.columns ?? 80, unicode: this.o.unicode ?? true, tick: this.tickCount,
      elapsedMs: this.elapsedBefore + (this.now() - this.started),
    });
    const up = this.lastLines > 0 ? `\x1b[${this.lastLines}A` : '';
    // Clear to the end of the screen from the top of the previous frame, then draw the new one.
    this.o.stream.write(`${up}\r\x1b[J${lines.join('\n')}\n`);
    this.lastLines = lines.length;
  }

  /** Stop animating and leave the last frame on screen (so questions can be asked below it). */
  pause(): void {
    if (!this.running) return;
    this.render();
    this.halt();
    this.elapsedBefore += this.now() - this.started;
    this.lastLines = 0;
    this.o.stream.write(SHOW);
  }

  resume(): void { this.start(); }

  /** Draw a final frame and give the terminal back. */
  stop(): void {
    if (!this.running) return;
    this.render();
    this.halt();
    this.o.stream.write(SHOW);
  }

  private halt(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }
}
