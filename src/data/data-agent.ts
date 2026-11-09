import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRunResult } from '../agents/provider.js';
import type { Executor, ExecContext } from '../engine/executor.js';
import { fileUrl } from '../evidence/evidence-store.js';
import { flattenResults, resultsText } from '../evidence/runs.js';
import { newId } from '../shared/ids.js';
import { tryJsonParse } from '../shared/json.js';
import { taskDir } from '../storage/paths.js';
import { basename, extname } from 'node:path';
import { CODE_SCHEMA, INTERPRET_SCHEMA, validateCode, validateInterpretation, type DataOutput } from './schemas.js';
import { codePrompt, interpretPrompt, repairPrompt, type DataFileInfo } from './prompts.js';

export const DATA_EXTENSIONS: readonly string[] = ['.csv', '.xlsx', '.json'];
export const MAX_ATTEMPTS = 3;
const PREVIEW_CHARS = 3000;

const failure = (message: string, costUsd: number, kind: 'agent_error' | 'budget' | 'unavailable' | 'aborted' = 'agent_error'): AgentRunResult => ({
  ok: false, text: '', costUsd, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 0, numTurns: 0,
  error: { kind, message },
});

/** A readable start of each data file, taken from the text Veritas already extracted. */
function dataFiles(ctx: ExecContext): { infos: DataFileInfo[]; inputs: { name: string; path: string }[] } {
  const infos: DataFileInfo[] = [];
  const inputs: { name: string; path: string }[] = [];
  for (const path of ctx.task.inputs) {
    if (!DATA_EXTENSIONS.includes(extname(path).toLowerCase())) continue;
    const name = basename(path);
    const source = ctx.evidence.findSource(ctx.task.id, fileUrl(name));
    const text = source ? ctx.evidence.readSnapshot(source) : '';
    const body = text.replace(/^# File:.*\n/, '').replace(/\n?=== .* ===\n/g, '\n').trim();
    infos.push({ name, preview: body.slice(0, PREVIEW_CHARS), parts: source?.units?.length ?? 0 });
    inputs.push({ name, path });
  }
  return { infos, inputs };
}

/**
 * The data worker: an agent writes code, Veritas runs it in the sandbox (repairing it if it fails), then an agent
 * describes what the stored results show. The agent never runs anything and never types a number the code did not produce.
 */
export const runDataTask: Executor = async (ctx) => {
  let cost = 0;
  const tokens = { input: 0, output: 0 };
  const left = (): number => ctx.capUsd - cost;
  const ask = async (prompt: string, schema: object): Promise<{ json?: unknown; error?: string }> => {
    if (left() < 0.01) return { error: 'budget' };
    const res = await ctx.provider.run({
      prompt, model: ctx.model, cwd: ctx.task.cwd, tools: [], jsonSchema: schema, maxBudgetUsd: left(), timeoutMs: ctx.timeoutMs, signal: ctx.signal,
    });
    cost += res.costUsd; tokens.input += res.inputTokens; tokens.output += res.outputTokens;
    if (!res.ok) return { error: res.error?.message ?? 'The agent failed.' };
    return { json: res.json ?? tryJsonParse(res.text) };
  };

  if (!ctx.sandbox) return failure('No sandbox is available, so analysis code cannot be run. Run `veritas setup`.', cost, 'unavailable');
  const { infos, inputs } = dataFiles(ctx);
  if (!inputs.length) return failure('This task has no data files (CSV, Excel or JSON) to analyse.', cost);

  const base = codePrompt(ctx.goal, ctx.subtask.instructions, infos);
  let prompt = base;
  let lastError = 'unknown error';
  let run: ReturnType<typeof ctx.runs.addRun> | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const written = await ask(prompt, CODE_SCHEMA);
    if (written.error) return failure(written.error === 'budget' ? 'The budget for this task ran out before the analysis worked.' : `Could not get analysis code: ${written.error}`, cost, written.error === 'budget' ? 'budget' : 'agent_error');
    const code = validateCode(written.json);
    if (!code.ok) { lastError = code.error; prompt = repairPrompt(base, '', code.error); continue; }

    const result = await ctx.sandbox.run({ code: code.code, inputFiles: inputs, outputDir: join(taskDir(ctx.homeDir, ctx.task.id), 'runs', newId('o')), signal: ctx.signal });
    if (ctx.signal?.aborted) return failure('Cancelled', cost, 'aborted');
    const resultsFile = result.outputs.find((o) => o.name === 'results.json');
    let results: unknown = null;
    if (resultsFile) results = tryJsonParse(readFileSync(resultsFile.path, 'utf8')) ?? null;
    run = ctx.runs.addRun({
      taskId: ctx.task.id, subtaskId: ctx.subtask.id, attempt, code: code.code, backend: result.backend, exitCode: result.exitCode,
      timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr, results, outputs: result.outputs, durationMs: result.durationMs,
    });
    if (run.ok && flattenResults(results).length) break;
    lastError = result.timedOut ? 'The program ran too long and was stopped.'
      : !resultsFile ? `The program finished but did not write output/results.json. ${result.stderr.slice(-800)}`
      : results == null ? 'output/results.json was not valid JSON (no NaN or Infinity).'
      : !flattenResults(results).length ? 'output/results.json was empty.'
      : result.stderr.slice(-1500) || `The program exited with code ${result.exitCode}.`;
    run = undefined;
    prompt = repairPrompt(base, code.code, `${lastError}\n\nPrinted so far:\n${result.stdout.slice(-1500)}`);
  }
  if (!run) return failure(`The analysis code did not run successfully after ${MAX_ATTEMPTS} attempts: ${lastError}`, cost);

  // Describe the stored results. A bad answer (unknown keys, a chart that does not exist) gets one correction.
  const outputNames = run.outputs.map((o) => o.name);
  const interpretBase = interpretPrompt(ctx.goal, ctx.subtask.instructions, run.code, resultsText(run.results), run.stdout, run.outputs);
  let interpretation = await ask(interpretBase, INTERPRET_SCHEMA);
  let checked = interpretation.error ? undefined : validateInterpretation(interpretation.json, run.results, outputNames);
  if (checked && !checked.ok) {
    interpretation = await ask(`${interpretBase}\n\nYour previous answer was rejected: ${checked.error}\nCorrect it.`, INTERPRET_SCHEMA);
    checked = interpretation.error ? undefined : validateInterpretation(interpretation.json, run.results, outputNames);
  }
  if (!checked || !checked.ok) return failure(`Could not describe the results: ${interpretation.error ?? (checked && !checked.ok ? checked.error : 'no answer')}`, cost, interpretation.error === 'budget' ? 'budget' : 'agent_error');

  const output: DataOutput = { runId: run.id, ...checked.value };
  return {
    ok: true, text: '', json: output, costUsd: cost, inputTokens: tokens.input, outputTokens: tokens.output,
    cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: run.durationMs, numTurns: 1,
  };
};
