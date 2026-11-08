import type { EventRow } from '../storage/models.js';
import { formatUsd } from '../cost/estimate.js';
import type { OutputFormatter } from './output.js';

const d = (e: EventRow): Record<string, unknown> => (e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {});

/** One readable line per event, or null for events that are not worth showing. */
export function describeEvent(out: OutputFormatter, e: EventRow, verbose = false): string | null {
  const x = d(e);
  switch (e.type) {
    case 'clarify.started': return out.dim('Checking the goal...');
    case 'clarify.skipped': return out.dim('Could not check the goal for questions; continuing.');
    case 'plan.started': return out.dim('Planning...');
    case 'plan.created': return out.dim(`Plan ready: ${x.tasks} task${x.tasks === 1 ? '' : 's'}`);
    case 'plan.failed': return out.error(`Planning failed: ${x.error}`);
    case 'subtask.started': return `  ${out.info('>')} ${x.key} ${out.dim(`${x.title} (${x.model})`)}`;
    case 'subtask.finished': return `  ${out.success('done')} ${x.key} ${out.dim(formatUsd(Number(x.costUsd ?? 0)))}`;
    case 'subtask.failed': return `  ${out.error('failed')} ${x.key}: ${x.error}`;
    case 'subtask.skipped': return `  ${out.warning('skipped')} ${x.key} ${out.dim(`(${x.because} did not finish)`)}`;
    case 'subtask.retry': return `  ${out.warning('retry')} ${x.key} ${out.dim(String(x.error))}`;
    case 'budget.exceeded': return out.warning(`Budget reached: ${formatUsd(Number(x.spentUsd))} of ${formatUsd(Number(x.limitUsd))}`);
    case 'budget.raised': return out.dim(`Budget raised to ${formatUsd(Number(x.limitUsd))}`);
    case 'approval.requested': return out.dim(`Approval needed: ${x.action}`);
    case 'policy.denied': return out.error(`Not allowed: ${x.action} (${x.reason})`);
    case 'task.interrupted': return out.warning('Stopped. The task is saved and can be resumed.');
    case 'cost.updated': return verbose ? out.dim(`  spent ${formatUsd(Number(x.spentUsd))} of ${formatUsd(Number(x.limitUsd))}`) : null;
    default: return null;
  }
}

/** Print events for one task as they are recorded. Returns a function that stops. */
export function followTask(
  out: OutputFormatter,
  subscribe: (fn: (e: EventRow) => void, taskId?: string) => () => void,
  taskId: string,
): () => void {
  return subscribe((e) => {
    const line = describeEvent(out, e, out.isVerbose());
    if (line !== null) out.writeln(line);
  }, taskId);
}
