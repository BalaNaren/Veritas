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
  /** Estimated total cost range in USD. */
  estimateUsd: { low: number; high: number };
  /** Assumptions the planner made, shown to the user. */
  assumptions: string[];
}
