import { scopeToFolder, ScopeError } from '../agents/scope.js';
import type { AgentRunResult } from '../agents/provider.js';
import type { Executor } from '../engine/executor.js';
import { tryJsonParse } from '../shared/json.js';
import { parseCommand } from './command.js';
import { codingPrompt, fixPrompt } from './prompts.js';
import { CODE_RESULT_SCHEMA, validateCodeResult } from './schemas.js';

export const MAX_ROUNDS = 3;
const EDIT_TOOLS = ['Read', 'Edit', 'Write', 'Grep', 'Glob'] as const;

const failure = (message: string, costUsd: number, kind: 'agent_error' | 'budget' | 'unavailable' | 'aborted' = 'agent_error'): AgentRunResult => ({
  ok: false, text: '', costUsd, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 0, numTurns: 0, error: { kind, message },
});

/**
 * The coding worker. An agent edits files in the separate working copy; Veritas then runs the project's tests itself
 * and, if they fail, sends the failure back for up to two more rounds. Veritas, not the agent, decides what the tests did.
 */
export const runCodeTask: Executor = async (ctx) => {
  if (!ctx.coding) return failure('This task has no working copy to change.', 0, 'unavailable');
  const { info } = ctx.coding;
  let cost = 0;
  const tokens = { input: 0, output: 0 };
  const testCommand = info.testCommand;
  // The agent may run exactly the approved test command, nothing else.
  // File tools are limited to the working copy by path rule; without that they work anywhere on the computer.
  let allowed: string[];
  try { allowed = scopeToFolder([...EDIT_TOOLS, ...(testCommand ? [`Bash(${parseCommand(testCommand).join(' ')})`] : [])], info.worktree); } catch (e) {
    if (e instanceof ScopeError) return failure(e.message, 0, 'unavailable');
    throw e;
  }
  const baselineRun = ctx.coding.lastRun('baseline');
  const baseline = baselineRun ? { passed: baselineRun.passed, exitCode: baselineRun.exitCode, tail: baselineRun.output } : null;

  let prompt = codingPrompt(ctx.goal, ctx.subtask.instructions, testCommand, baseline);
  let summary = '';
  let notes = '';
  let lastTest: Awaited<ReturnType<typeof ctx.coding.runTests>> = null;
  const rounds: { round: number; testRunId: string | null; passed: boolean | null }[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const remaining = ctx.capUsd - cost;
    if (remaining < 0.02) return failure('The budget for this task ran out before the change was finished.', cost, 'budget');
    const res = await ctx.provider.run({
      prompt, model: ctx.model, cwd: info.worktree, tools: [...EDIT_TOOLS, ...(testCommand ? ['Bash'] : [])], allowedTools: allowed,
      jsonSchema: CODE_RESULT_SCHEMA, maxBudgetUsd: remaining, timeoutMs: ctx.timeoutMs, signal: ctx.signal,
    });
    cost += res.costUsd; tokens.input += res.inputTokens; tokens.output += res.outputTokens;
    if (!res.ok) return failure(`The coding agent failed: ${res.error?.message ?? 'unknown error'}`, cost, res.error?.kind === 'budget' ? 'budget' : res.error?.kind === 'aborted' ? 'aborted' : 'agent_error');
    const parsed = validateCodeResult(res.json ?? tryJsonParse(res.text));
    if (parsed.ok) { summary = parsed.value.summary; notes = parsed.value.notes; }
    else if (!summary) summary = 'The agent made changes but did not describe them.';

    lastTest = await ctx.coding.runTests(`round${round}`, ctx.signal);
    if (ctx.signal?.aborted) return failure('Cancelled', cost, 'aborted');
    rounds.push({ round, testRunId: lastTest?.id ?? null, passed: lastTest ? lastTest.passed : null });
    if (!lastTest || lastTest.passed) break;
    if (round < MAX_ROUNDS) prompt = fixPrompt(testCommand!, lastTest.exitCode, lastTest.timedOut, lastTest.output);
  }

  return {
    ok: true, text: '', json: { summary, notes, rounds }, costUsd: cost, inputTokens: tokens.input, outputTokens: tokens.output,
    cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 0, numTurns: rounds.length,
  };
};
