import type { AgentRunResult, ModelProvider } from '../agents/provider.js';
import type { EvidenceStore } from '../evidence/evidence-store.js';
import type { RunStore } from '../evidence/runs.js';
import type { Sandbox } from '../sandbox/types.js';
import type { SubtaskRow, TaskRow } from '../storage/models.js';

/** Everything a worker kind that does more than one agent call needs. */
export interface ExecContext {
  task: TaskRow;
  subtask: SubtaskRow;
  /** The goal with the decisions made so far. */
  goal: string;
  model: string;
  /** What this task may spend in total. */
  capUsd: number;
  timeoutMs: number;
  signal?: AbortSignal;
  provider: ModelProvider;
  evidence: EvidenceStore;
  runs: RunStore;
  sandbox?: Sandbox;
  homeDir: string;
}

/** A worker kind may replace the single agent call with its own steps (for example write code, run it, describe the results). */
export type Executor = (ctx: ExecContext) => Promise<AgentRunResult>;
