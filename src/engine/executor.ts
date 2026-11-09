import type { AgentRunResult, ModelProvider } from '../agents/provider.js';
import type { EvidenceStore } from '../evidence/evidence-store.js';
import type { RunStore } from '../evidence/runs.js';
import type { Sandbox } from '../sandbox/types.js';
import type { CodingInfo, SubtaskRow, TaskRow } from '../storage/models.js';
import type { TestRunRow } from '../coding/test-runs.js';

/** What a coding task's worker needs: the separate working copy, and a way to run the project's tests there. */
export interface CodingServices {
  info: CodingInfo & { worktree: string };
  /** Run the approved test command in the working copy and record it. Returns null when the project has no test command. */
  runTests(phase: string, signal?: AbortSignal): Promise<TestRunRow | null>;
  /** The most recent recorded run with this phase prefix, if any. */
  lastRun(phase: string): TestRunRow | undefined;
}

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
  coding?: CodingServices;
  homeDir: string;
}

/** A worker kind may replace the single agent call with its own steps (for example write code, run it, describe the results). */
export type Executor = (ctx: ExecContext) => Promise<AgentRunResult>;
