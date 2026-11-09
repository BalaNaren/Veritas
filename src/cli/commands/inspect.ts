import { formatUsd } from '../../cost/estimate.js';
import { EvidenceStore } from '../../evidence/evidence-store.js';
import { TERMINAL_TASK_STATUSES } from '../../storage/models.js';
import type { App } from '../app.js';
import { describeEvent } from '../progress.js';
import { formatPlan, subtaskTable, taskTable, truncate } from '../format.js';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { taskDir } from '../../storage/paths.js';
import { writeFileAtomic } from '../../shared/fs.js';
import { EXPORT_FORMATS, exportReport, type ExportFormat } from '../../write/export.js';
import { ValidationError, type Command, type CommandResult } from '../types.js';
import { requireTask } from './run.js';

const ok: CommandResult = { success: true };

export function inspectCommands(app: App): Command[] {
  const { out } = app.rt;
  const json = (flags: Record<string, unknown>): boolean => flags.json === true || flags.format === 'json';
  return [
    {
      name: 'list',
      description: 'Show recent tasks',
      options: [
        { name: 'limit', type: 'number', description: 'How many to show (default 20)' },
        { name: 'json', type: 'boolean', description: 'Machine-readable output' },
      ],
      action: async (ctx) => {
        const limit = ctx.flags.limit === undefined ? 20 : Number(ctx.flags.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new ValidationError('--limit must be a whole number above 0.');
        const tasks = app.store.listTasks(limit);
        if (json(ctx.flags)) out.printJson(tasks);
        else if (!tasks.length) out.writeln('No tasks yet. Start one with: veritas run "<goal>"');
        else out.writeln(taskTable(out, tasks));
        return ok;
      },
    },
    {
      name: 'status',
      description: 'Show tasks that are not finished',
      options: [{ name: 'json', type: 'boolean', description: 'Machine-readable output' }],
      action: async (ctx) => {
        const active = app.store.listTasks(200).filter((t) => !TERMINAL_TASK_STATUSES.includes(t.status));
        if (json(ctx.flags)) out.printJson(active);
        else if (!active.length) out.writeln('Nothing is running or waiting.');
        else out.writeln(taskTable(out, active));
        return ok;
      },
    },
    {
      name: 'show',
      description: 'Show everything about one task: plan, progress, costs, pending approvals',
      options: [
        { name: 'json', type: 'boolean', description: 'Machine-readable output' },
        { name: 'events', type: 'boolean', description: 'Include the full event history' },
        { name: 'outputs', type: 'boolean', description: 'Include each task\'s output' },
        { name: 'claims', type: 'boolean', description: 'List every claim with its verification status' },
        { name: 'claim', type: 'number', description: 'Show one claim in full: source, exact quote, each check and the reason' },
      ],
      action: async (ctx) => {
        const task = requireTask(app, ctx.args[0]);
        const subtasks = app.store.listSubtasks(task.id);
        const approvals = app.store.listApprovals(task.id);
        const evidence = new EvidenceStore(app.store, app.home);
        if (json(ctx.flags)) {
          out.printJson({
            task, subtasks, approvals, claims: evidence.listClaims(task.id), sources: evidence.listSources(task.id),
            events: ctx.flags.events === true ? app.store.listEvents(task.id) : undefined,
          });
          return ok;
        }
        if (ctx.flags.claim !== undefined) {
          const seq = Number(ctx.flags.claim);
          const c = evidence.listClaims(task.id).find((x) => x.seq === seq);
          if (!c) throw new ValidationError(`This task has no claim ${ctx.flags.claim}. See \`veritas show ${task.id} --claims\`.`);
          const src = c.sourceId ? evidence.getSource(c.sourceId) : undefined;
          out.writeln(out.bold(`Claim ${c.seq} [${c.status}]${c.important ? ' (important)' : ''}`));
          out.writeln(c.text);
          out.writeln(`\nSource:  ${src ? `${src.finalUrl} (${src.quality}${src.publishedAt ? `, dated ${src.publishedAt}` : ''}, fetched ${src.fetchedAt})` : `${c.url ?? 'none given'} (not fetched)`}`);
          out.writeln(`Quote:   ${c.quote ?? 'none given'}`);
          if (c.reason) out.writeln(`Reason:  ${c.reason}`);
          out.writeln('\nChecks:');
          for (const k of c.checks) out.writeln(`  ${k.passed ? out.success('pass') : out.error('FAIL')}  ${k.step}: ${k.detail}`);
          if (!c.checks.length) out.writeln('  (not checked yet)');
          return ok;
        }
        if (ctx.flags.claims === true) {
          const claims = evidence.listClaims(task.id);
          if (!claims.length) { out.writeln('This task has no claims (only research tasks produce them).'); return ok; }
          out.writeln(out.table({
            columns: [
              { key: 'seq', header: '#', width: 4, align: 'right' }, { key: 'status', header: 'Status', width: 10 },
              { key: 'claim', header: 'Claim', width: 56 }, { key: 'reason', header: 'Reason', width: 34 },
            ],
            data: claims.map((c) => ({ seq: c.seq, status: c.status, claim: truncate(c.text, 56), reason: truncate(c.reason ?? '', 34) })),
          }));
          out.writeln(`Details of one claim: veritas show ${task.id} --claim <number>`);
          return ok;
        }
        out.writeln(out.bold(truncate(task.goal, 120)));
        out.writeln(`${task.id}   status: ${task.status}   spent ${formatUsd(task.spentUsd)} of ${formatUsd(task.budgetUsd)}`);
        if (task.error) out.writeln(out.error(`Error: ${task.error}`));
        if (task.plan) { out.writeln(); out.writeln(formatPlan(out, task)); }
        if (subtasks.length) { out.writeln(); out.writeln(subtaskTable(out, subtasks)); }
        const pending = approvals.filter((a) => a.status === 'pending');
        for (const a of pending) out.writeln(out.warning(`Waiting for approval: ${a.action} (veritas approve ${task.id})`));
        if (task.resultPath) out.writeln(`Result: ${task.resultPath}`);
        if (ctx.flags.outputs === true) {
          for (const s of subtasks) out.writeln(`\n--- ${s.key}: ${s.title} ---\n${typeof s.output === 'string' ? s.output : JSON.stringify(s.output)}`);
        }
        if (ctx.flags.events === true) {
          out.writeln('\nEvents:');
          for (const e of app.store.listEvents(task.id)) {
            out.writeln(`  ${e.ts}  ${e.type}  ${describeEvent(out, e, true)?.trim() ?? ''}`);
          }
        }
        return ok;
      },
    },
    {
      name: 'export',
      description: 'Save a finished report as Markdown, Word (docx) or PDF',
      options: [
        { name: 'as', type: 'string', description: 'md, docx or pdf (default docx)', choices: [...EXPORT_FORMATS] },
        { name: 'out', type: 'string', description: 'Where to save it (default: the task folder)' },
      ],
      examples: [{ command: 'veritas export task_1a2b --as pdf --out ~/Desktop/report.pdf', description: 'Save a PDF on the desktop' }],
      action: async (ctx) => {
        const task = requireTask(app, ctx.args[0]);
        if (task.status !== 'done' || !task.resultPath) throw new ValidationError(`This task has no finished report yet (status: ${task.status}).`);
        const format = (ctx.flags.as === undefined ? 'docx' : String(ctx.flags.as)) as ExportFormat;
        if (!EXPORT_FORMATS.includes(format)) throw new ValidationError(`--as must be one of ${EXPORT_FORMATS.join(', ')}.`);
        const markdown = readFileSync(task.resultPath, 'utf8');
        const target = ctx.flags.out ? resolve(app.rt.cwd, String(ctx.flags.out)) : join(taskDir(app.home, task.id), `result.${format}`);
        writeFileAtomic(target, await exportReport(markdown, format, dirname(task.resultPath)));
        out.writeln(`Saved ${target}`);
        return ok;
      },
    },
    {
      name: 'cost',
      description: 'Show what you have spent, by day, task and model',
      options: [
        { name: 'days', type: 'number', description: 'Only look at the last N days' },
        { name: 'json', type: 'boolean', description: 'Machine-readable output' },
      ],
      action: async (ctx) => {
        let since: string | undefined;
        if (ctx.flags.days !== undefined) {
          const days = Number(ctx.flags.days);
          if (!Number.isFinite(days) || days <= 0) throw new ValidationError('--days must be a number above 0.');
          since = new Date(Date.now() - days * 86_400_000).toISOString();
        }
        const r = app.store.costReport(since);
        if (json(ctx.flags)) { out.printJson(r); return ok; }
        out.writeln(out.bold(`Total spent${since ? ` in the last ${ctx.flags.days} days` : ''}: ${formatUsd(r.totalUsd)}`));
        if (!r.byDay.length) { out.writeln('Nothing spent yet.'); return ok; }
        out.writeln('\nBy day (tasks started that day):');
        out.writeln(out.table({ columns: [{ key: 'day', header: 'Day', width: 12 }, { key: 'tasks', header: 'Tasks', width: 6, align: 'right' }, { key: 'usd', header: 'Spent', width: 10, align: 'right' }],
          data: r.byDay.map((d) => ({ day: d.day, tasks: d.tasks, usd: formatUsd(d.usd) })) }));
        out.writeln('\nBy model (agent runs only, planning not included):');
        out.writeln(out.table({ columns: [{ key: 'model', header: 'Model', width: 16 }, { key: 'runs', header: 'Runs', width: 6, align: 'right' }, { key: 'usd', header: 'Spent', width: 10, align: 'right' }],
          data: r.byModel.map((m) => ({ model: m.model, runs: m.runs, usd: formatUsd(m.usd) })) }));
        out.writeln('\nMost expensive tasks:');
        out.writeln(out.table({ columns: [{ key: 'id', header: 'Task', width: 21 }, { key: 'slug', header: 'Goal', width: 40 }, { key: 'usd', header: 'Spent', width: 10, align: 'right' }],
          data: r.byTask.map((t) => ({ id: t.id, slug: t.slug, usd: formatUsd(t.usd) })) }));
        return ok;
      },
    },
  ];
}
