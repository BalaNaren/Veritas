import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { CommandError } from '../../coding/command.js';
import { RepoError } from '../../coding/repo.js';
import { EXTENSIONS } from '../../documents/types.js';
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
    if (approval.action === 'cmd.first_run') {
      const d = approval.detail as { command: string; purpose: string; repo: string };
      out.writeln(out.warning(`Veritas wants to run \`${d.command}\` (${d.purpose === 'setup' ? 'to set the project up' : 'to run the project\'s tests'}) in a separate copy of ${d.repo}.`));
      out.writeln('That runs the project\'s own code on your computer, like running it yourself. It is asked once per project and command.');
      return askChoice(app, 'Allow it?');
    }
    if (approval.action === 'git.commit') {
      const d = approval.detail as { branch: string; files: string[]; stat: string; tests: string };
      out.writeln(out.bold(`Save these changes as a commit on the new branch ${d.branch}?`));
      out.writeln(d.stat);
      out.writeln(d.tests);
      return askChoice(app, 'Commit?');
    }
    if (approval.action === 'git.merge') {
      const d = approval.detail as { branch: string; into: string; repo: string };
      out.writeln(out.bold(`Merge ${d.branch} into ${d.into} in ${d.repo}? This changes your working folder.`));
      return askChoice(app, 'Merge?');
    }
    if (approval.action === 'git.push') {
      const d = approval.detail as { branch: string; remote: string };
      out.writeln(out.bold(`Send ${d.branch} to the remote "${d.remote}" and open a pull request? This leaves your computer.`));
      return askChoice(app, 'Push?');
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

const MAX_FILES = 100;

/** Files given with --file (repeatable). A folder stands for the supported files directly inside it. */
function filesFrom(ctx: CommandContext, cwd: string): string[] | undefined {
  const raw = ctx.flags.file;
  if (raw === undefined) return undefined;
  const given = (Array.isArray(raw) ? raw : [raw]).map(String);
  if (given.some((g) => g === 'true' || !g.trim())) throw new ValidationError('--file needs a file or folder name.');
  const out: string[] = [];
  for (const g of given) {
    const path = resolve(cwd, g);
    let info;
    try { info = statSync(path); } catch { throw new ValidationError(`Cannot find ${g}.`); }
    if (info.isDirectory()) {
      const inside = readdirSync(path).filter((n) => !n.startsWith('.') && EXTENSIONS[extname(n).toLowerCase()]).sort().map((n) => join(path, n));
      if (!inside.length) throw new ValidationError(`${g} has no supported files (${Object.keys(EXTENSIONS).join(' ')}).`);
      out.push(...inside);
    } else if (!EXTENSIONS[extname(path).toLowerCase()]) {
      throw new ValidationError(`${g}: this file type is not supported (supported: ${Object.keys(EXTENSIONS).join(' ')}).`);
    } else out.push(path);
  }
  const unique = [...new Set(out)];
  if (unique.length > MAX_FILES) throw new ValidationError(`At most ${MAX_FILES} files per task (got ${unique.length}).`);
  return unique;
}

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
        { name: 'file', type: 'array', description: 'A file or folder to work on (repeat for several): PDF, Word, Excel, CSV, text, Markdown or JSON' },
        { name: 'quick', type: 'boolean', description: 'Skip the clarifying questions' },
        { name: 'clarify', type: 'boolean', description: 'When not interactive, still check the goal and record default answers as assumptions' },
      ],
      examples: [{ command: 'veritas run "Summarise the main causes of the 2008 crisis" --budget 1', description: 'Run with a $1 limit' }],
      action: async (ctx) => {
        const task = app.engine().createTask(goalFrom(ctx), { budgetUsd: budgetFrom(ctx), cwd: app.rt.cwd, files: filesFrom(ctx, app.rt.cwd) });
        app.rt.out.writeln(app.rt.out.dim(`Task ${task.id}`));
        return exit(await drive(app, task.id, { yesPlan: ctx.flags.yesPlan === true, interactive: interactive(ctx), clarify: clarifyMode(ctx, interactive(ctx)) }));
      },
    },
    {
      name: 'code',
      description: 'Make a change to a git repository in a separate copy, run its tests, and show you the result',
      options: [
        { name: 'repo', type: 'string', description: 'The repository (default: the current folder)' },
        { name: 'test-cmd', type: 'string', description: 'Command that runs the tests, for example "npm test" (default: detected)' },
        { name: 'setup-cmd', type: 'string', description: 'Command to run once first, for example "npm ci"' },
        { name: 'budget', type: 'number', description: 'Spending limit in US dollars' },
        { name: 'yes-plan', type: 'boolean', description: 'Approve the plan without asking (commits, merges and pushes always ask)' },
        { name: 'quick', type: 'boolean', description: 'Skip the clarifying questions' },
      ],
      examples: [{ command: 'veritas code "Fix the failing add() test" --repo ~/projects/demo', description: 'Work in a copy; nothing in the project changes until you run `veritas apply`' }],
      action: async (ctx) => {
        let task;
        try {
          task = await app.engine().createCodingTask(goalFrom(ctx), {
            repo: resolve(app.rt.cwd, typeof ctx.flags.repo === 'string' ? ctx.flags.repo : '.'), budgetUsd: budgetFrom(ctx), cwd: app.rt.cwd,
            testCommand: typeof ctx.flags.testCmd === 'string' ? ctx.flags.testCmd : undefined, setupCommand: typeof ctx.flags.setupCmd === 'string' ? ctx.flags.setupCmd : undefined,
          });
        } catch (e) {
          if (e instanceof RepoError || e instanceof CommandError) throw new ValidationError(e.message);
          throw e;
        }
        app.rt.out.writeln(app.rt.out.dim(`Task ${task.id}`));
        if (task.coding!.testCommand) app.rt.out.writeln(app.rt.out.dim(`Tests: ${task.coding!.testCommand}`)); else app.rt.out.writeln(app.rt.out.warning('No test command was found, so no tests will be run. Use --test-cmd to name one.'));
        return exit(await drive(app, task.id, { yesPlan: ctx.flags.yesPlan === true, interactive: interactive(ctx), clarify: clarifyMode(ctx, interactive(ctx)) }));
      },
    },
    {
      name: 'apply',
      description: 'Keep a coding task\'s change: save it as a commit, and with --merge or --pr also merge it or open a pull request (each asks first)',
      options: [
        { name: 'merge', type: 'boolean', description: 'Also merge into the branch you started from' },
        { name: 'pr', type: 'boolean', description: 'Also push the branch and open a pull request (needs the gh tool)' },
        { name: 'remote', type: 'string', description: 'Remote to push to (default origin)' },
      ],
      action: async (ctx) => {
        const task = requireTask(app, ctx.args[0]);
        const approver = interactive(ctx) ? makeApprover(app) : undefined;
        const r = await app.engine().apply(task.id, { merge: ctx.flags.merge === true, pr: ctx.flags.pr === true, remote: typeof ctx.flags.remote === 'string' ? ctx.flags.remote : undefined }, approver);
        const out = app.rt.out;
        if (r.state === 'applied') { for (const n of r.notes) out.writeln(n); return exit(0); }
        if (r.state === 'nothing') { out.writeln(r.reason); return exit(0); }
        if (r.state === 'defer') {
          out.writeln(r.reason);
          out.writeln(`To approve: veritas approve ${task.id}, then run this command again. (Or run it in a terminal to be asked now.)`);
          return exit(3);
        }
        if (r.state === 'denied') { out.writeln(r.reason); return exit(3); }
        out.writeErrorln(out.error(r.reason));
        return exit(1);
      },
    },
    {
      name: 'discard',
      description: 'Throw away a coding task\'s separate copy (the branch is kept if it holds a saved commit)',
      options: [
        { name: 'yes', type: 'boolean', description: 'Do not ask for confirmation' },
        { name: 'force', type: 'boolean', description: 'Also delete the branch even if it holds a saved commit' },
      ],
      action: async (ctx) => {
        const task = requireTask(app, ctx.args[0]);
        if (!task.coding?.worktree) { app.rt.out.writeln('There is no separate copy to discard.'); return exit(0); }
        if (ctx.flags.yes !== true) {
          if (!interactive(ctx)) throw new ValidationError('Run this in a terminal, or pass --yes to confirm.');
          const a = (await app.rt.ask('Throw away the separate copy and its unsaved changes? [y/N] ')).trim().toLowerCase();
          if (a !== 'y' && a !== 'yes') { app.rt.out.writeln('Nothing was removed.'); return exit(0); }
        }
        const r = await app.engine().discard(task.id, ctx.flags.force === true);
        app.rt.out.writeln(r.keptBranch ? `Removed the copy. The branch ${r.keptBranch} was kept because it holds a saved commit.` : 'Removed the copy and its branch.');
        return exit(0);
      },
    },
    {
      name: 'plan',
      description: 'Plan a goal and show the plan and cost estimate without running anything',
      options: [
        { name: 'budget', type: 'number', description: 'Spending limit in US dollars' },
        { name: 'file', type: 'array', description: 'A file or folder to work on (repeat for several)' },
        { name: 'clarify', type: 'boolean', description: 'Check the goal first and record default answers as assumptions' },
      ],
      action: async (ctx) => {
        const task = app.engine().createTask(goalFrom(ctx), { budgetUsd: budgetFrom(ctx), cwd: app.rt.cwd, files: filesFrom(ctx, app.rt.cwd) });
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
        if (deny) { if (task.status !== 'done') engine.cancel(task.id); return exit(0); }
        if (task.status === 'done' && task.coding) {
          app.rt.out.writeln(`Now run: veritas apply ${task.id}${pending.some((a) => a.action === 'git.merge') ? ' --merge' : ''}${pending.some((a) => a.action === 'git.push') ? ' --pr' : ''}`);
          return exit(0);
        }
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

