import type { ModelRoles } from '../cli/types.js';
import type { PlannedSubtask } from '../engine/plan.js';

/**
 * Typical cost of one agent run by model family, in USD. These are
 * conservative starting values used only until Veritas has measured real runs
 * on this machine; estimates built from them are labelled as such.
 */
export const DEFAULT_RUN_COST_USD: Readonly<Record<string, number>> = {
  haiku: 0.03,
  sonnet: 0.15,
  opus: 0.4,
};

const LOW_FACTOR = 0.5;
const HIGH_FACTOR = 2;

export type EstimateBasis = 'history' | 'defaults';

export interface CostEstimate {
  low: number;
  high: number;
  /** Where the numbers came from. */
  basis: EstimateBasis;
}

/** Measured average run cost per model alias, taken from past tasks. */
export type CostHistory = Readonly<Record<string, { average: number; samples: number }>>;

export function modelFamily(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('opus')) return 'opus';
  return 'sonnet';
}

export function estimateRunCost(model: string, history?: CostHistory): { usd: number; basis: EstimateBasis } {
  const measured = history?.[model];
  if (measured && measured.samples >= 3) return { usd: measured.average, basis: 'history' };
  return { usd: DEFAULT_RUN_COST_USD[modelFamily(model)] ?? DEFAULT_RUN_COST_USD.sonnet!, basis: 'defaults' };
}

/** Estimate the cost of running all tasks of a plan (excluding planning). */
export function estimatePlanCost(
  subtasks: readonly PlannedSubtask[],
  models: Pick<ModelRoles, 'worker'>,
  history?: CostHistory,
): CostEstimate {
  let sum = 0;
  let allMeasured = subtasks.length > 0;
  for (const s of subtasks) {
    const model = s.model?.trim() || models.worker;
    const e = estimateRunCost(model, history);
    sum += e.usd;
    if (e.basis !== 'history') allMeasured = false;
  }
  return {
    low: round(sum * LOW_FACTOR),
    high: round(sum * HIGH_FACTOR),
    basis: allMeasured ? 'history' : 'defaults',
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;

export function formatUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
