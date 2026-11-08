const EPS = 1e-9;

/**
 * Tracks a spending limit while several agents run at once.
 *
 * Each agent run reserves a cap before it starts; the cap is what the agent
 * itself is allowed to spend. Because every reservation comes out of what is
 * left, agents running in parallel cannot together exceed the limit by more
 * than the overshoot a single run can make.
 */
export class Budget {
  private reservations = new Map<string, number>();

  constructor(private limitUsd: number, private spentUsd = 0) {
    if (!Number.isFinite(limitUsd) || limitUsd <= 0) throw new Error('Budget limit must be a positive number');
  }

  get limit(): number { return this.limitUsd; }
  get spent(): number { return this.spentUsd; }
  get remaining(): number { return this.limitUsd - this.spentUsd; }
  get reserved(): number {
    let sum = 0;
    for (const v of this.reservations.values()) sum += v;
    return sum;
  }
  /** Money that is neither spent nor promised to a running agent. */
  get available(): number { return this.remaining - this.reserved; }
  get exhausted(): boolean { return this.remaining <= EPS; }

  setLimit(limitUsd: number): void {
    if (!Number.isFinite(limitUsd) || limitUsd <= 0) throw new Error('Budget limit must be a positive number');
    this.limitUsd = limitUsd;
  }

  /**
   * Reserve a cap for one run: a fair share of the whole limit
   * (`limit / concurrency`), but never more than what is available.
   * Returns the cap, or `null` when less than `minCap` is available.
   */
  allocate(id: string, concurrency: number, minCap = 0.02): number | null {
    if (this.reservations.has(id)) throw new Error(`Reservation already exists: ${id}`);
    const share = this.limitUsd / Math.max(1, concurrency);
    const cap = Math.min(share, this.available);
    if (cap < minCap - EPS) return null;
    this.reservations.set(id, cap);
    return cap;
  }

  /** Give back a reservation and record what the run actually cost. */
  settle(id: string, actualCostUsd: number): void {
    this.reservations.delete(id);
    if (Number.isFinite(actualCostUsd) && actualCostUsd > 0) this.spentUsd += actualCostUsd;
  }

  /** Record spending that did not go through a reservation (planning, writing). */
  record(costUsd: number): void {
    if (Number.isFinite(costUsd) && costUsd > 0) this.spentUsd += costUsd;
  }
}
