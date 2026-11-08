/**
 * The kinds of worker a plan can use. Each kind fixes which tools its agent may
 * touch, so what an agent can do is decided here and never by the model.
 * Later milestones add kinds (research, documents, data, coding).
 */
export interface WorkerKind {
  id: string;
  /** Shown to the planner so it can choose well. */
  description: string;
  /** Exact built-in tools the agent may use. Empty means none. */
  tools: readonly string[];
  /** Tool patterns pre-approved for the agent (only needed for tools that ask permission). */
  allowedTools?: readonly string[];
}

export const WORKER_KINDS: Readonly<Record<string, WorkerKind>> = {
  general: {
    id: 'general',
    description: 'Reasoning, writing, analysis and answering from general knowledge. Has no tools: it cannot browse the web or read files.',
    tools: [],
  },
};

export const kindIds = (): string[] => Object.keys(WORKER_KINDS);

export function getKind(id: string): WorkerKind {
  const kind = WORKER_KINDS[id];
  if (!kind) throw new Error(`Unknown worker kind: ${id}`);
  return kind;
}
