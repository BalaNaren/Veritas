import { formatUsd } from '../cost/estimate.js';
import type { SubtaskRow, TaskRow } from '../storage/models.js';
import type { OutputFormatter } from './output.js';

export const truncate = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function formatPlan(out: OutputFormatter, task: TaskRow): string {
  const plan = task.plan;
  if (!plan) return 'No plan yet.';
  const lines: string[] = [];
  lines.push(out.bold(`Plan for: ${truncate(task.goal, 100)}`));
  if (plan.assumptions.length) {
    lines.push('', 'Assumptions:');
    for (const a of plan.assumptions) lines.push(`  - ${a}`);
  }
  lines.push('', out.table({
    columns: [
      { key: 'key', header: 'Task', width: 8 },
      { key: 'title', header: 'What it does', width: 50 },
      { key: 'kind', header: 'Kind', width: 10 },
      { key: 'deps', header: 'After', width: 14 },
    ],
    data: plan.subtasks.map((s) => ({ key: s.key, title: s.title, kind: s.kind, deps: s.dependsOn.join(', ') || '-' })),
  }));
  const basis = plan.estimateBasis === 'history'
    ? 'based on your earlier runs'
    : 'a rough guess from default figures; not measured on your machine yet';
  lines.push(`Estimated cost: ${formatUsd(plan.estimateUsd.low)} to ${formatUsd(plan.estimateUsd.high)} (${basis}).`);
  lines.push(`Budget: ${formatUsd(task.budgetUsd)}. Already spent on planning: ${formatUsd(task.spentUsd)}.`);
  if (plan.estimateUsd.low > task.budgetUsd) {
    lines.push(out.warning('The low estimate is above the budget; the task will likely pause before it finishes.'));
  }
  return lines.join('\n');
}

export function subtaskTable(out: OutputFormatter, subtasks: readonly SubtaskRow[]): string {
  return out.table({
    columns: [
      { key: 'key', header: 'Task', width: 8 },
      { key: 'title', header: 'Title', width: 40 },
      { key: 'status', header: 'Status', width: 10 },
      { key: 'cost', header: 'Cost', width: 9, align: 'right' },
      { key: 'attempts', header: 'Tries', width: 5, align: 'right' },
    ],
    data: subtasks.map((s) => ({ key: s.key, title: s.title, status: s.status, cost: formatUsd(s.costUsd), attempts: s.attempts })),
  });
}

export function taskTable(out: OutputFormatter, tasks: readonly TaskRow[]): string {
  return out.table({
    columns: [
      { key: 'id', header: 'Id', width: 21 },
      { key: 'status', header: 'Status', width: 17 },
      { key: 'spent', header: 'Spent', width: 9, align: 'right' },
      { key: 'goal', header: 'Goal', width: 50 },
    ],
    data: tasks.map((t) => ({ id: t.id, status: t.status, spent: formatUsd(t.spentUsd), goal: truncate(t.goal, 50) })),
  });
}
