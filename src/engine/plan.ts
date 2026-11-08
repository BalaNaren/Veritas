/** One task inside a plan, as proposed by the planner. */
export interface PlannedSubtask {
  /** Short identifier chosen by the planner (for example "t1"), used by `dependsOn`. */
  key: string;
  title: string;
  /** What kind of worker should do it (for example "general", "research"). */
  kind: string;
  /** Self-contained instructions for the agent. */
  instructions: string;
  /** Keys of the tasks that must finish first. */
  dependsOn: string[];
  /** Optional model alias override for this task. */
  model?: string;
}

export interface Plan {
  subtasks: PlannedSubtask[];
  /** Estimated cost range in USD for running the tasks, computed by Veritas (not by the planner). */
  estimateUsd: { low: number; high: number };
  /** Whether the estimate comes from measured past runs or from built-in defaults. */
  estimateBasis: 'history' | 'defaults';
  /** Assumptions the planner made, shown to the user. */
  assumptions: string[];
}
