import type { Plan } from '../engine/plan.js';

export type TaskStatus =
  | 'draft' | 'clarifying' | 'planned' | 'awaiting_approval' | 'running' | 'verifying' | 'writing'
  | 'paused' | 'done' | 'failed' | 'cancelled';

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['done', 'failed', 'cancelled'];

export type SubtaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';

/** What a coding task works on. The user's own working tree is never part of this. */
export interface CodingInfo {
  /** The user's repository (top level). */
  repo: string;
  /** Branch that was checked out when the task started, and its commit. The work starts from that commit. */
  baseBranch: string;
  baseSha: string;
  /** Separate working folder and branch the agent works in; null until created, and after cleanup. */
  worktree: string | null;
  branch: string | null;
  /** Command Veritas runs to test, as the user approved it. */
  testCommand: string | null;
  /** Optional command run once before testing (for example installing dependencies). */
  setupCommand: string | null;
}

export interface TaskRow {
  id: string;
  slug: string;
  goal: string;
  type: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  budgetUsd: number;
  spentUsd: number;
  /** How agents are run, for example "claude-code". */
  mode: string;
  cwd: string;
  assumptions: string[];
  /** Absolute paths of the files the user gave this task. */
  inputs: string[];
  coding: CodingInfo | null;
  plan: Plan | null;
  resultPath: string | null;
  error: string | null;
}

export interface SubtaskRow {
  id: string;
  taskId: string;
  /** Planner-chosen key, unique within the task. */
  key: string;
  idx: number;
  title: string;
  kind: string;
  instructions: string;
  model: string | null;
  dependsOn: string[];
  status: SubtaskStatus;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  output: unknown;
  error: string | null;
  attempts: number;
}

export interface EventRow {
  id: number;
  taskId: string;
  subtaskId: string | null;
  ts: string;
  type: string;
  data: unknown;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface ApprovalRow {
  id: string;
  taskId: string;
  action: string;
  detail: unknown;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}
