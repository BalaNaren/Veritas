import type { ModelProvider, AgentRunResult } from '../agents/provider.js';
import { modelFor } from '../agents/models.js';
import type { VeritasConfig } from '../cli/types.js';
import { estimatePlanCost, type CostHistory } from '../cost/estimate.js';
import type { Plan } from './plan.js';
import { kindIds } from './kinds.js';

const DATA_KINDS = ['csv', 'xlsx', 'json'];
import { planJsonSchema, validatePlanDraft, type PlanLimits } from './plan-schema.js';
import { goalWithContext, plannerPrompt, plannerRetryPrompt, type FileSummary } from './prompts.js';
import { tryJsonParse } from '../shared/json.js';

export interface PlannerOptions {
  provider: ModelProvider;
  config: Pick<VeritasConfig, 'models' | 'maxSubtasks' | 'agentTimeoutMs'>;
  cwd: string;
  history?: CostHistory;
  /** Answers and assumptions already settled with the person. */
  decided?: readonly string[];
  /** Files the user supplied (already read), so the planner can use document tasks. */
  files?: readonly FileSummary[];
  /** Things remembered from earlier tasks that may help (preferences, useful sources). */
  hints?: readonly string[];
  /** True when analysis code can be run (a sandbox is set up), so the data kind may be used. */
  dataAvailable?: boolean;
  signal?: AbortSignal;
  /** Spending cap for one planner call. */
  maxBudgetUsd?: number;
}

export type PlanOutcome =
  | { ok: true; plan: Plan; costUsd: number }
  | { ok: false; error: string; costUsd: number };

/** Ask the planner agent to split a goal into tasks. Retries once with feedback if the answer is invalid. */
export async function planGoal(goal: string, opts: PlannerOptions): Promise<PlanOutcome> {
  const limits: PlanLimits = { maxSubtasks: opts.config.maxSubtasks, kinds: kindIds({ files: (opts.files?.length ?? 0) > 0, data: !!opts.dataAvailable && (opts.files ?? []).some((f) => DATA_KINDS.includes(f.kind)) }) };
  const schema = planJsonSchema(limits);
  const model = modelFor('planner', opts.config.models);
  let cost = 0;
  const fullGoal = goalWithContext(goal, opts.decided ?? []);
  let prompt = plannerPrompt(fullGoal, limits.maxSubtasks, limits.kinds, opts.files, opts.hints);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res: AgentRunResult = await opts.provider.run({
      prompt, model, cwd: opts.cwd, tools: [], jsonSchema: schema,
      maxBudgetUsd: opts.maxBudgetUsd, timeoutMs: opts.config.agentTimeoutMs, signal: opts.signal,
    });
    cost += res.costUsd;
    if (!res.ok) return { ok: false, error: `Planning failed: ${res.error?.message ?? 'unknown error'}`, costUsd: cost };

    const raw = res.json ?? tryJsonParse(res.text);
    const check = validatePlanDraft(raw, limits);
    if (check.ok) {
      const est = estimatePlanCost(check.draft.subtasks, opts.config.models, opts.history);
      return {
        ok: true, costUsd: cost,
        plan: {
          subtasks: check.draft.subtasks,
          assumptions: check.draft.assumptions,
          estimateUsd: { low: est.low, high: est.high },
          estimateBasis: est.basis,
        },
      };
    }
    if (attempt === 2) return { ok: false, error: `The planner returned an invalid plan: ${check.errors.join(' ')}`, costUsd: cost };
    prompt = plannerRetryPrompt(fullGoal, limits.maxSubtasks, limits.kinds, check.errors, opts.files, opts.hints);
  }
  return { ok: false, error: 'Planning failed.', costUsd: cost };
}
