import type { ModelRoles } from '../cli/types.js';

export type AgentRole = keyof ModelRoles;

/** Default model aliases per role (override in the config file). */
export const DEFAULT_MODELS: ModelRoles = {
  planner: 'opus',
  clarifier: 'sonnet',
  worker: 'sonnet',
  checker: 'haiku',
  writer: 'opus',
};

export function modelFor(role: AgentRole, models: ModelRoles, override?: string | null): string {
  return (override && override.trim()) || models[role];
}
