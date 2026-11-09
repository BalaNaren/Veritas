export type Decision = 'allow' | 'ask' | 'deny';

export interface PolicyRule {
  /** Exact action name, or a prefix ending in `*` (for example `git.*`). */
  action: string;
  decision: Decision;
  reason: string;
  /** When true, no flag or option may pre-approve this action; the user must be asked every time. */
  locked?: boolean;
}

export interface PolicyResult {
  decision: Decision;
  reason: string;
  /** The rule that matched, if any. */
  rule?: PolicyRule;
}

/**
 * Decides what may happen automatically, what needs the user, and what is
 * never allowed. Anything not covered by a rule is denied.
 */
export class Policy {
  private readonly rules: readonly PolicyRule[];

  constructor(rules: readonly PolicyRule[] = DEFAULT_RULES) {
    this.rules = rules;
  }

  evaluate(action: string): PolicyResult {
    // Exact matches win over prefixes; longer prefixes win over shorter ones.
    let best: PolicyRule | undefined;
    let bestScore = -1;
    for (const rule of this.rules) {
      const score = matchScore(rule.action, action);
      if (score > bestScore) { best = rule; bestScore = score; }
    }
    if (!best) return { decision: 'deny', reason: `No rule allows "${action}"` };
    return { decision: best.decision, reason: best.reason, rule: best };
  }

  /**
   * A copy where the given actions are pre-approved by an explicit user choice
   * (for example a command-line flag). A pre-approval can never override a
   * `deny` rule or a `locked` rule.
   */
  withAllowed(actions: readonly string[], reason: string): Policy {
    const rules: PolicyRule[] = this.rules.map((rule) =>
      actions.includes(rule.action) && rule.decision === 'ask' && !rule.locked
        ? { ...rule, decision: 'allow', reason }
        : rule);
    for (const action of actions) {
      if (this.rules.some((r) => r.action === action)) continue;
      const current = this.evaluate(action);
      if (current.decision === 'ask' && !current.rule?.locked) rules.push({ action, decision: 'allow', reason });
    }
    return new Policy(rules);
  }
}

function matchScore(pattern: string, action: string): number {
  if (pattern === action) return 1_000_000 + pattern.length;
  if (pattern.endsWith('*') && action.startsWith(pattern.slice(0, -1))) return pattern.length;
  return -1;
}

export const DEFAULT_RULES: readonly PolicyRule[] = [
  { action: 'agent.run', decision: 'allow', reason: 'Running agents is the purpose of the tool' },
  { action: 'plan.start', decision: 'ask', reason: 'You approve the plan and cost before anything runs' },
  { action: 'budget.exceed', decision: 'ask', locked: true, reason: 'Spending beyond the budget always needs your approval' },
  { action: 'task.write_output', decision: 'allow', reason: 'Results are written inside the task folder' },
  // Coding tasks. The agent works in a separate copy; nothing reaches your repository without you saying so.
  { action: 'cmd.first_run', decision: 'ask', reason: 'Running a project command (such as its tests) runs that project\'s own code on your computer' },
  { action: 'git.commit', decision: 'ask', locked: true, reason: 'Saving the changes as a commit always needs your approval' },
  { action: 'git.merge', decision: 'ask', locked: true, reason: 'Merging into your branch always needs your approval' },
  { action: 'git.push', decision: 'ask', locked: true, reason: 'Sending anything to a remote always needs your approval' },
  { action: 'fs.write_outside_output', decision: 'deny', reason: 'Veritas does not write files outside the task folder and the separate working copy' },
  // Never available in this version.
  { action: 'email.send', decision: 'deny', reason: 'Sending messages is not supported' },
  { action: 'payment.make', decision: 'deny', reason: 'Payments are not supported' },
  { action: 'system.configure', decision: 'deny', reason: 'Veritas never changes system or global settings' },
];
