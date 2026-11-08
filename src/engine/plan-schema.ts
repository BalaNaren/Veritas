import type { PlannedSubtask } from './plan.js';

export interface PlanDraft {
  subtasks: PlannedSubtask[];
  assumptions: string[];
}

export type PlanValidation = { ok: true; draft: PlanDraft } | { ok: false; errors: string[] };

export interface PlanLimits {
  maxSubtasks: number;
  kinds: readonly string[];
}

const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/i;
const MAX_TITLE = 200;
const MAX_INSTRUCTIONS = 8000;
const MAX_ASSUMPTIONS = 10;
const MAX_ASSUMPTION_LENGTH = 300;

/** JSON Schema handed to the agent runtime so it returns the right shape. */
export function planJsonSchema(limits: PlanLimits): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['subtasks', 'assumptions'],
    properties: {
      subtasks: {
        type: 'array',
        minItems: 1,
        maxItems: limits.maxSubtasks,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'title', 'kind', 'instructions', 'dependsOn'],
          properties: {
            key: { type: 'string', description: 'Short identifier such as t1, t2 (letters, digits, - and _).' },
            title: { type: 'string' },
            kind: { type: 'string', enum: [...limits.kinds] },
            instructions: { type: 'string' },
            dependsOn: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      assumptions: { type: 'array', items: { type: 'string' } },
    },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Check a planner answer. Never trust the model's output without this. */
export function validatePlanDraft(value: unknown, limits: PlanLimits): PlanValidation {
  const errors: string[] = [];
  if (!isObj(value)) return { ok: false, errors: ['The answer must be a JSON object.'] };
  const rawTasks = value.subtasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) return { ok: false, errors: ['"subtasks" must be a non-empty array.'] };
  if (rawTasks.length > limits.maxSubtasks) errors.push(`There are ${rawTasks.length} tasks but at most ${limits.maxSubtasks} are allowed.`);

  const subtasks: PlannedSubtask[] = [];
  const seen = new Set<string>();
  rawTasks.forEach((raw, i) => {
    const where = `Task ${i + 1}`;
    if (!isObj(raw)) { errors.push(`${where} must be an object.`); return; }
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
    const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim() : '';
    if (!KEY_RE.test(key)) errors.push(`${where}: "key" must start with a letter and use only letters, digits, - and _ (up to 32 characters).`);
    else if (seen.has(key.toLowerCase())) errors.push(`${where}: key "${key}" is used more than once.`);
    seen.add(key.toLowerCase());
    if (!title || title.length > MAX_TITLE) errors.push(`${where}: "title" must be 1-${MAX_TITLE} characters.`);
    if (!limits.kinds.includes(kind)) errors.push(`${where}: "kind" must be one of ${limits.kinds.join(', ')}.`);
    if (!instructions || instructions.length > MAX_INSTRUCTIONS) errors.push(`${where}: "instructions" must be 1-${MAX_INSTRUCTIONS} characters.`);
    const depsRaw = raw.dependsOn ?? [];
    if (!Array.isArray(depsRaw) || depsRaw.some((d) => typeof d !== 'string')) {
      errors.push(`${where}: "dependsOn" must be an array of keys.`);
      return;
    }
    subtasks.push({ key, title, kind, instructions, dependsOn: [...new Set((depsRaw as string[]).map((d) => d.trim()))] });
  });

  // Dependencies must exist, must not point at the task itself, and must not form a cycle.
  const byKey = new Map(subtasks.map((s) => [s.key.toLowerCase(), s]));
  for (const s of subtasks) {
    for (const d of s.dependsOn) {
      if (d.toLowerCase() === s.key.toLowerCase()) errors.push(`Task "${s.key}" depends on itself.`);
      else if (!byKey.has(d.toLowerCase())) errors.push(`Task "${s.key}" depends on unknown task "${d}".`);
    }
  }
  if (!errors.length && hasCycle(subtasks)) errors.push('The tasks depend on each other in a circle.');

  const assumptionsRaw = value.assumptions ?? [];
  let assumptions: string[] = [];
  if (!Array.isArray(assumptionsRaw) || assumptionsRaw.some((a) => typeof a !== 'string')) {
    errors.push('"assumptions" must be an array of strings.');
  } else {
    assumptions = (assumptionsRaw as string[]).map((a) => a.trim().slice(0, MAX_ASSUMPTION_LENGTH)).filter(Boolean).slice(0, MAX_ASSUMPTIONS);
  }

  if (errors.length) return { ok: false, errors };
  // Canonicalise dependency keys to the exact spelling used by the tasks.
  for (const s of subtasks) s.dependsOn = s.dependsOn.map((d) => byKey.get(d.toLowerCase())!.key);
  return { ok: true, draft: { subtasks, assumptions } };
}

/** True when the dependency graph has a cycle (Kahn's algorithm). */
export function hasCycle(subtasks: readonly Pick<PlannedSubtask, 'key' | 'dependsOn'>[]): boolean {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of subtasks) { indegree.set(s.key, 0); dependents.set(s.key, []); }
  for (const s of subtasks) {
    for (const d of s.dependsOn) {
      if (!indegree.has(d)) continue;
      indegree.set(s.key, indegree.get(s.key)! + 1);
      dependents.get(d)!.push(s.key);
    }
  }
  const queue = [...indegree].filter(([, n]) => n === 0).map(([k]) => k);
  let visited = 0;
  while (queue.length) {
    const k = queue.shift()!;
    visited++;
    for (const next of dependents.get(k)!) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) queue.push(next);
    }
  }
  return visited !== subtasks.length;
}
