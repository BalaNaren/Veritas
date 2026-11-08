import { readFileSync } from 'node:fs';
import { formatUsd } from '../../cost/estimate.js';
import type { ClarifyQuestion } from '../../clarify/clarifier.js';
import type { Approver, ClarifyOptions } from '../../engine/engine.js';
import type { TaskRow } from '../../storage/models.js';
import { App } from '../app.js';
import { formatPlan } from '../format.js';
import { followTask } from '../progress.js';
import { ValidationError, type Command, type CommandContext, type CommandResult } from '../types.js';

export function requireTask(app: App, ref: string | undefined): TaskRow {
  if (!ref) throw new ValidationError('Give a task id (see `veritas list`).');
  let task: TaskRow | undefined;
  try { task = app.store.findTask(ref); } catch (e) { throw new ValidationError(e instanceof Error ? e.message : String(e)); }
  if (!task) throw new ValidationError(`No task matches "${ref}". See \`veritas list\`.`);
  return task;
}

type Answer = 'approved' | 'denied' | 'defer';

async function askChoice(app: App, question: string): Promise<Answer> {
  for (let i = 0; i < 3; i++) {
    const a = (await app.rt.ask(`${question} [y = yes, n = cancel, l = decide later] `)).trim().toLowerCase();
    if (a === 'y' || a === 'yes') return 'approved';
    if (a === 'n' || a === 'no') return 'denied';
    if (a === 'l' || a === 'later' || a === '') return 'defer';
  }
  return 'defer';
}

function makeApprover(app: App): Approver {
  return async ({ approval, task }) => {
    const out = app.rt.out;
    if (approval.action === 'plan.start') {
      out.writeln(formatPlan(out, task));
      out.writeln();
      return askChoice(app, 'Run this plan?');
    }
    if (approval.action === 'budget.exceed') {
      const d = approval.detail as { spentUsd: number; limitUsd: number; newLimitUsd: number };
      out.writeln(out.warning(`Spent ${formatUsd(d.spentUsd)} of the ${formatUsd(d.limitUsd)} budget and there is more to do.`));
      return askChoice(app, `Raise the budget to ${formatUsd(d.newLimitUsd)} and continue?`);
    }
    out.writeln(`Approval needed: ${approval.action}`);
    return askChoice(app, 'Allow this?');
  };
}

/** Put each question to the person; Enter takes the default, a number picks a suggested option. */
async function askQuestions(app: App, questions: ClarifyQuestion[]): Promise<Record<string, string>> {
  const out = app.rt.out;
  out.writeln(out.bold('A few questions before planning (press Enter to accept the suggested answer):'));
  const answers: Record<string, string> = {};
  for (const q of questions) {
    out.writeln(`\n${q.text}`);
    q.options.forEach((o, i) => out.writeln(`  ${i + 1}. ${o}`));
    const raw = (await app.rt.ask(`  [${q.default}] > `)).trim();
    const pick = Number(raw);
    answers[q.id] = !raw ? q.default : Number.isInteger(pick) && pick >= 1 && pick <= q.options.length ? q.options[pick - 1]! : raw;
  }
  out.writeln();
  return answers;
}

/** Run (or continue) a task, showing progress, and report where it ended up. Returns the exit code. */
export async function drive(app: App, taskId: string, opts: { yesPlan?: boolean; interactive: boolean; clarify?: 'off' | 'defaults' | 'ask' }): Promise<number> {
  const { out } = app.rt;
  const engine = app.engine({ preApprove: opts.yesPlan ? ['plan.start'] : [] });
  const stopFollowing = followTask(out, (fn, id) => engine.events.subscribe(fn, id), taskId);
  const abort = new AbortController();
  let interrupts = 0;
  const stopListening = app.rt.onInterrupt(() => {
    interrupts++;
    if (interrupts === 1) { out.writeln(out.warning('Stopping... press Ctrl-C again to quit immediately.')); abort.abort(); }
    else process.exit(130);
  });
  try {
    const clarify: ClarifyOptions = { mode: opts.clarify ?? 'off', ask: (q) => askQuestions(app, q) };
    const result = await engine.execute(taskId, { signal: abort.signal, clarify, approver: opts.interactive ? makeApprover(app) : undefined });
    return report(app, result.task, result.resultPath);
  } finally {
    stopListening();
    stopFollowing();
  }
}

function report(app: App, task: TaskRow, resultPath?: string): number {
  const { out } = app.rt;
  const spent = `Spent ${formatUsd(task.spentUsd)} of ${formatUsd(task.budgetUsd)}.`;
  switch (task.status) {
    case 'done': {
      out.writeln();
      out.writeln(out.success(`Done. ${spent}`));
      if (resultPath) {
        out.writeln(`Result saved to ${resultPath}`);
        out.writeln();
        out.writeln(readFileSync(resultPath, 'utf8'));
      }
      return 0;
    }
    case 'awaiting_approval':
      out.writeln(formatPlan(out, task));
      out.writeln();
      out.writeln(`Nothing has run yet. To go ahead: veritas approve ${task.id}`);
      return 3;
    case 'paused': {
      const pending = app.store.listApprovals(task.id, 'pending');
      out.writeln(out.warning(`Paused. ${spent}`));
      out.writeln(pending.length ? `A decision is waiting: veritas approve ${task.id}` : `To continue: veritas resume ${task.id}`);
      return 3;
    }
    case 'failed':
      out.writeErrorln(out.error(`Failed: ${task.error ?? 'unknown error'}`));
      out.writeln(spent);
      return 1;
    case 'cancelled':
      out.writeln(`Cancelled. ${spent}`);
      return 3;
    default:
      out.writeln(`Status: ${task.status}. ${spent}`);
      return 3;
  }
}

const goalFrom = (ctx: CommandContext): string => {
  const goal = ctx.args.join(' ').trim();
  if (!goal) throw new ValidationError('Describe the goal, for example: veritas run "Compare two laptop models for video editing"');
  return goal;
};

const budgetFrom = (ctx: CommandContext): number | undefined => {
  const raw = ctx.flags.budget;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError('--budget must be a positive number of US dollars.');
  return n;
};

/** Interactive runs ask questions unless --quick; unattended runs only use the model's default answers when --clarify is given. */
const clarifyMode = (ctx: CommandContext, interactive: boolean): 'off' | 'defaults' | 'ask' =>
  ctx.flags.quick === true ? 'off' : interactive ? 'ask' : ctx.flags.clarify === true ? 'defaults' : 'off';

const exit = (code: number): CommandResult => ({ success: code === 0, exitCode: code });

export function runCommands(app: App): Command[] {
  const interactive = (ctx: CommandContext): boolean => app.rt.interactive && ctx.flags.interactive !== false;
  return [
    {
      name: 'run',
      description: 'Plan a goal, ask for your approval, then do the work',
      options: [
        { name: 'budget', type: 'number', description: 'Spending limit in US dollars (default from config)' },
        { name: 'yes-plan', type: 'boolean', description: 'Approve the plan without asking (budget increases still always ask)' },
        { name: 'quick', type: 'boolean', description: 'Skip the clarifying questions' },
        { name: 'clarify', type: 'boolean', description: 'When not interactive, still check the goal and record default answers as assumptions' },
      ],
      examples: [{ command: 'veritas run "Summarise the main causes of the 2008 crisis" --budget 1', description: 'Run with a $1 limit' }],
      action: async (ctx) => {
        const task = app.engine().createTask(goalFrom(ctx), { budgetUsd: budgetFrom(ctx), cwd: app.rt.cwd });
        app.rt.out.writeln(app.rt.out.dim(`Task ${task.id}`));
        return exit(await drive(app, task.id, { yesPlan: ctx.flags.yesPlan === true, interactive: interactive(ctx), clarify: clarifyMode(ctx, interactive(ctx)) }));
      },
    },
    {
      name: 'plan',
      description: 'Plan a goal and show the plan and cost estimate without running anything',
      options: [
        { name: 'budget', type: 'number', description: 'Spending limit in US dollars' },
        { name: 'clarify', type: 'boolean', description: 'Check the goal first and record default answers as assumptions' },
      ],
      action: async (ctx) => {
        const task = app.engine().createTask(goalFrom(ctx), { budgetUsd: budgetFrom(ctx), cwd: app.rt.cwd });
        app.rt.out.writeln(app.rt.out.dim(`Task ${task.id}`));
        return exit(await drive(app, task.id, { interactive: false, clarify: clarifyMode(ctx, false) }));
      },
    },
    {
      name: 'approve',
      description: 'Approve (or with --deny, refuse) what a task is waiting on, then continue it',
      options: [{ name: 'deny', type: 'boolean', description: 'Refuse instead of approving' }],
      action: async (ctx) => {
        const task = requireTask(app, ctx.args[0]);
        const pending = app.store.listApprovals(task.id, 'pending');
        if (!pending.length) { app.rt.out.writeln('Nothing is waiting for approval on this task.'); return exit(0); }
        const engine = app.engine();
        const deny = ctx.flags.deny === true;
        for (const a of pending) {
          engine.decide(a.id, deny ? 'denied' : 'approved');
          app.rt.out.writeln(`${deny ? 'Refused' : 'Approved'}: ${a.action}`);
        }
        if (deny) { engine.cancel(task.id); return exit(0); }
        return exit(await drive(app, task.id, { interactive: interactive(ctx) }));
      },
    },
    {
      name: 'resume',
      description: 'Continue a paused or interrupted task',
      action: async (ctx) => exit(await drive(app, requireTask(app, ctx.args[0]).id, { interactive: interactive(ctx) })),
    },
    {
      name: 'cancel',
      description: 'Stop a task for good',
      action: async (ctx) => {
        const task = requireTask(app, ctx.args[0]);
        const updated = app.engine().cancel(task.id);
        app.rt.out.writeln(updated.status === 'cancelled' ? `Cancelled ${task.id}.` : `Task is already ${updated.status}.`);
        return exit(0);
      },
    },
  ];
}

