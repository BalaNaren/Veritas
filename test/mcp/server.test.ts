import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { TOOLS, handleMessage, serveStdio, type McpDeps } from '../../src/mcp/server.js';
import { Store } from '../../src/storage/store.js';

const deps = (): McpDeps => {
  const home = mkdtempSync(join(tmpdir(), 'veritas-mcp-'));
  return { store: Store.open(':memory:'), home };
};
const call = async (d: McpDeps, name: string, args = {}) => await handleMessage(d, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as any;

describe('mcp server', () => {
  it('answers initialize, negotiating a known version', async () => {
    const r = await handleMessage(deps(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) as any;
    expect(r.result.protocolVersion).toBe('2025-06-18');
    expect(r.result.capabilities).toEqual({ tools: {} });
    const other = await handleMessage(deps(), { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }) as any;
    expect(other.result.protocolVersion).toBe('2025-11-25');
  });

  it('ignores notifications and rejects unknown methods', async () => {
    expect(await handleMessage(deps(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    expect(((await handleMessage(deps(), { jsonrpc: '2.0', id: 3, method: 'nope' })) as any).error.code).toBe(-32601);
  });

  it('offers only read-only tools: nothing that starts, approves or deletes', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(['veritas_list', 'veritas_status', 'veritas_show', 'veritas_claims', 'veritas_plan', 'veritas_cost']);
    expect(names.join(' ')).not.toMatch(/approve|run|delete|apply|cancel|create|resume/);
  });

  it('lists and shows tasks', async () => {
    const d = deps();
    const t = d.store.createTask({ slug: 'moon-facts', goal: 'Find facts', type: 'general', budgetUsd: 2, mode: 'claude-code', cwd: '/tmp' });
    expect(JSON.parse((await call(d, 'veritas_list')).result.content[0].text)[0].id).toBe(t.id);
    expect(JSON.parse((await call(d, 'veritas_status')).result.content[0].text)).toHaveLength(1);
    const shown = JSON.parse((await call(d, 'veritas_show', { task: 'moon-facts' })).result.content[0].text);
    expect(shown.goal).toBe('Find facts');
    expect(JSON.parse((await call(d, 'veritas_claims', { task: t.id })).result.content[0].text)).toEqual([]);
    expect(JSON.parse((await call(d, 'veritas_cost')).result.content[0].text).totalUsd).toBe(0);
  });

  it('reports tool problems as tool errors, not protocol errors', async () => {
    const d = deps();
    const r = await call(d, 'veritas_show', { task: 'missing' });
    expect(r.result.isError).toBe(true);
    expect((await call(d, 'veritas_cost', { days: -1 })).result.isError).toBe(true);
    expect((await call(d, 'veritas_approve')).error.code).toBe(-32602);
  });

  it('serves line by line and survives garbage', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (c) => lines.push(...String(c).split('\n').filter(Boolean)));
    const done = serveStdio(deps(), input, output);
    input.write('not json\n{"jsonrpc":"2.0","id":7,"method":"ping"}\n');
    input.end();
    await done;
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { jsonrpc: '2.0', id: 7, result: {} },
    ]);
  });

  it('plans a goal and tells the person to approve in their own terminal', async () => {
    const d = deps();
    let seen: [string, number | undefined] | undefined;
    d.plan = async (goal, budget) => {
      seen = [goal, budget];
      const t = d.store.createTask({ slug: 'g', goal, type: 'general', budgetUsd: budget ?? 2, mode: 'claude-code', cwd: '/tmp' });
      return d.store.updateTask(t.id, { status: 'awaiting_approval' });
    };
    const r = await call(d, 'veritas_plan', { goal: 'Compare two laptops', budget_usd: 1.5 });
    expect(seen).toEqual(['Compare two laptops', 1.5]);
    const out = JSON.parse(r.result.content[0].text);
    expect(out.status).toBe('awaiting_approval');
    expect(out.nextStep).toContain('veritas approve');
  });

  it('rejects bad planning input and hides the tool when planning is unavailable', async () => {
    const d = deps();
    expect((await call(d, 'veritas_plan', { goal: 'x' })).error.code).toBe(-32602);
    expect((await handleMessage(d, { jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any).result.tools.map((t: any) => t.name)).not.toContain('veritas_plan');
    d.plan = async () => { throw new Error('should not be called'); };
    expect((await call(d, 'veritas_plan', { goal: '' })).result.isError).toBe(true);
    expect((await call(d, 'veritas_plan', { goal: 'x', budget_usd: 11 })).result.isError).toBe(true);
    expect((await call(d, 'veritas_plan', { goal: 'x', budget_usd: -1 })).result.isError).toBe(true);
    d.plan = async () => { throw new Error('boom'); };
    expect((await call(d, 'veritas_plan', { goal: 'x' })).result.content[0].text).toContain('boom');
  });
});
