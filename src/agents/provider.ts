/** What kind of failure ended an agent run. */
export type AgentErrorKind =
  | 'unavailable'      // the runtime is missing or could not be started
  | 'timeout'
  | 'aborted'
  | 'budget'           // the run hit its spending cap
  | 'output_too_large'
  | 'process'          // non-zero exit without a usable result
  | 'envelope'         // output could not be understood
  | 'agent_error';     // the agent reported an error

export interface AgentError {
  kind: AgentErrorKind;
  message: string;
}

export interface AgentRunRequest {
  /** Complete instructions for the agent. Sent over stdin, never on the command line. */
  prompt: string;
  /** Model alias or id understood by the runtime (for example "sonnet"). */
  model: string;
  /** Working directory for the agent. */
  cwd: string;
  /** Exact built-in tools the agent may use. An empty list disables all tools. */
  tools: readonly string[];
  /** Tool patterns pre-approved for use (only tools that would otherwise need permission). */
  allowedTools?: readonly string[];
  /** Extra directories the agent may read. Must be absolute. */
  addDirs?: readonly string[];
  /** JSON Schema the final answer must satisfy. */
  jsonSchema?: object;
  appendSystemPrompt?: string;
  /** Hard spending cap for this run, in USD. */
  maxBudgetUsd?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  ok: boolean;
  /** Final text answer ("" when there is none). */
  text: string;
  /** Parsed structured answer when a schema was requested and produced. */
  json?: unknown;
  /** Actual cost of the run in USD, as reported by the runtime (0 when unknown). */
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  numTurns: number;
  sessionId?: string;
  error?: AgentError;
}

/** Anything that can run an agent: headless Claude Code today, the API later. */
export interface ModelProvider {
  readonly id: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
