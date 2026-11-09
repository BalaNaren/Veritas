import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { EvidenceStore } from '../evidence/evidence-store.js';
import { TERMINAL_TASK_STATUSES } from '../storage/models.js';
import type { TaskRow } from '../storage/models.js';
import type { Store } from '../storage/store.js';
import { PRODUCT_NAME, VERSION } from '../version.js';

/**
 * A small MCP server over stdio so Claude Code and other MCP clients can look at Veritas work.
 *
 * It cannot approve, run, change or delete anything. The one tool that calls a model, veritas_plan, only plans and
 * stops at the approval step. Messages are JSON-RPC 2.0, one per line. It speaks the handshake used by protocol versions up to 2025-11-25.
 */
export interface McpDeps {
  store: Store;
  home: string;
  /** Plans a goal as a new task and stops at "awaiting approval". Absent: the planning tool is not offered. */
  plan?: (goal: string, budgetUsd?: number) => Promise<TaskRow>;
}

/** The most one planned task may be allowed to spend when asked through MCP. */
export const MAX_MCP_BUDGET_USD = 10;

/** Versions this server can speak, newest first. */
export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
const MAX_TEXT = 100_000;
const ID = { type: 'string', description: 'Task id, a unique start of one, or its slug (see veritas_list).' };

export const TOOLS = [
  { name: 'veritas_list', description: 'List recent Veritas tasks with status and spending.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'How many (default 20, at most 100).' } } } },
  { name: 'veritas_status', description: 'List Veritas tasks that are not finished (running, waiting for approval or paused).', inputSchema: { type: 'object', properties: {} } },
  { name: 'veritas_show', description: 'Show one task: goal, status, plan steps, cost, pending approvals, and the finished report when there is one.', inputSchema: { type: 'object', properties: { task: ID }, required: ['task'] } },
  { name: 'veritas_claims', description: 'List the claims of a research task with their verification status, or show one claim in full (source, exact quote, each check).', inputSchema: { type: 'object', properties: { task: ID, claim: { type: 'integer', description: 'Claim number to show in full.' } }, required: ['task'] } },
  { name: 'veritas_plan', description: 'Plan a goal as a new Veritas task. Only plans: it records the plan and cost estimate and stops, and nothing runs until the person approves it in their own terminal with `veritas approve <task id>`. Planning itself uses a little of their Claude allowance.', inputSchema: { type: 'object', properties: { goal: { type: 'string', description: 'What to research, analyse or find out.' }, budget_usd: { type: 'number', description: `Spending limit for the task if approved (at most ${MAX_MCP_BUDGET_USD}).` } }, required: ['goal'] } },
  { name: 'veritas_cost', description: 'What has been spent in total, by day, by task and by model.', inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Only the last N days.' } } } },
] as const;

type Json = Record<string, unknown>;
interface Request { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

class ToolError extends Error {}

const json = (v: unknown): string => JSON.stringify(v, null, 2);
const clip = (s: string): string => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[cut: too long]` : s);

function findTask(d: McpDeps, ref: unknown) {
  if (typeof ref !== 'string' || !ref) throw new ToolError('task is required');
  let t;
  try { t = d.store.findTask(ref); } catch (e) { throw new ToolError(e instanceof Error ? e.message : String(e)); }
  if (!t) throw new ToolError(`No task matches "${ref}".`);
  return t;
}

export async function callTool(d: McpDeps, name: string, args: Json): Promise<string> {
  switch (name) {
    case 'veritas_plan': {
      if (!d.plan) throw new ToolError('Planning is not available in this server.');
      const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
      if (!goal || goal.length > 4000) throw new ToolError('goal is required (at most 4000 characters)');
      let budget: number | undefined;
      if (args.budget_usd !== undefined) {
        budget = Number(args.budget_usd);
        if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_MCP_BUDGET_USD) throw new ToolError(`budget_usd must be above 0 and at most ${MAX_MCP_BUDGET_USD}`);
      }
      let t: TaskRow;
      try { t = await d.plan(goal, budget); } catch (e) { throw new ToolError(`Planning failed: ${e instanceof Error ? e.message : String(e)}`); }
      return json({ ...brief(t), plan: t.plan, nextStep: t.status === 'awaiting_approval' ? `Nothing has run. The person must approve in their terminal: veritas approve ${t.id}` : `Task is ${t.status}.` });
    }
    case 'veritas_list': {
      const limit = Math.min(100, Math.max(1, Math.trunc(Number(args.limit ?? 20)) || 20));
      return json(d.store.listTasks(limit).map(brief));
    }
    case 'veritas_status':
      return json(d.store.listTasks(200).filter((t) => !TERMINAL_TASK_STATUSES.includes(t.status)).map(brief));
    case 'veritas_show': {
      const t = findTask(d, args.task);
      let report: string | undefined;
      if (t.resultPath) { try { report = clip(readFileSync(t.resultPath, 'utf8')); } catch { report = undefined; } }
      return json({
        ...brief(t), error: t.error, assumptions: t.assumptions, plan: t.plan,
        steps: d.store.listSubtasks(t.id).map((s) => ({ key: s.key, title: s.title, kind: s.kind, status: s.status })),
        pendingApprovals: d.store.listApprovals(t.id, 'pending').map((a) => a.action),
        report,
      });
    }
    case 'veritas_claims': {
      const t = findTask(d, args.task);
      const ev = new EvidenceStore(d.store, d.home);
      const claims = ev.listClaims(t.id);
      if (args.claim !== undefined) {
        const c = claims.find((x) => x.seq === Number(args.claim));
        if (!c) throw new ToolError(`This task has no claim ${String(args.claim)}.`);
        const src = c.sourceId ? ev.getSource(c.sourceId) : undefined;
        return json({ ...c, source: src ? { url: src.finalUrl, quality: src.quality, fetchedAt: src.fetchedAt } : undefined });
      }
      return json(claims.map((c) => ({ seq: c.seq, status: c.status, text: c.text, reason: c.reason })));
    }
    case 'veritas_cost': {
      let since: string | undefined;
      if (args.days !== undefined) {
        const days = Number(args.days);
        if (!Number.isFinite(days) || days <= 0) throw new ToolError('days must be a number above 0');
        since = new Date(Date.now() - days * 86_400_000).toISOString();
      }
      return json(d.store.costReport(since));
    }
    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

function brief(t: { id: string; slug: string; goal: string; type: string; status: string; createdAt: string; budgetUsd: number; spentUsd: number }): Json {
  return { id: t.id, slug: t.slug, goal: t.goal, type: t.type, status: t.status, createdAt: t.createdAt, budgetUsd: t.budgetUsd, spentUsd: t.spentUsd };
}

const reply = (id: unknown, result: unknown): Json => ({ jsonrpc: '2.0', id, result });
const errorReply = (id: unknown, code: number, message: string): Json => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Handle one parsed message. Returns the reply, or undefined for notifications. */
export async function handleMessage(d: McpDeps, msg: unknown): Promise<Json | undefined> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return errorReply(null, -32600, 'Invalid request');
  const r = msg as Request;
  if (typeof r.method !== 'string') return r.id === undefined ? undefined : errorReply(r.id, -32600, 'Invalid request');
  if (r.id === undefined || r.id === null) return undefined; // notification (for example notifications/initialized)
  const params = (r.params && typeof r.params === 'object' ? r.params : {}) as Json;
  switch (r.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const version = (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
      return reply(r.id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'veritas', title: PRODUCT_NAME, version: VERSION },
        instructions: 'Read-only view of Veritas tasks, reports, claims and costs. It cannot start or approve anything.' });
    }
    case 'ping': return reply(r.id, {});
    case 'tools/list': return reply(r.id, { tools: d.plan ? TOOLS : TOOLS.filter((t) => t.name !== 'veritas_plan') });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !TOOLS.some((t) => t.name === name) || (name === 'veritas_plan' && !d.plan)) return errorReply(r.id, -32602, `Unknown tool ${String(name)}`);
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json;
      try { return reply(r.id, { content: [{ type: 'text', text: await callTool(d, name, args) }], isError: false }); }
      catch (e) { return reply(r.id, { content: [{ type: 'text', text: e instanceof ToolError ? e.message : 'The tool failed.' }], isError: true }); }
    }
    default: return errorReply(r.id, -32601, `Method not found: ${r.method}`);
  }
}

/** Serve until the input ends. Only protocol messages are written to `output`. */
export function serveStdio(d: McpDeps, input: Readable, output: Writable): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const p = (async () => {
      let out: Json | undefined;
      let msg: unknown;
      try { msg = JSON.parse(line); } catch { out = errorReply(null, -32700, 'Parse error'); }
      if (!out) { try { out = await handleMessage(d, msg); } catch { out = errorReply((msg as Request | null)?.id ?? null, -32603, 'Internal error'); } }
      if (out) output.write(`${JSON.stringify(out)}\n`);
    })();
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
  return new Promise((resolve) => rl.on('close', () => { void Promise.all(pending).then(() => resolve()); }));
}
