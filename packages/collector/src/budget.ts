import type { DB } from "./db.js";

/** Start of the current calendar month in UTC, as an ISO string comparable with responses.requested_at. */
export function monthStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** USD spent on real (non-mock) API calls since the start of this UTC month. */
export function spentThisMonth(db: DB, now: Date = new Date()): number {
  const row = db
    .prepare<[string], { spent: number | null }>(
      `SELECT SUM(r.cost_usd) AS spent FROM responses r JOIN runs ON runs.id = r.run_id
       WHERE runs.is_mock = 0 AND r.requested_at >= ?`,
    )
    .get(monthStartUtc(now));
  return row?.spent ?? 0;
}

/** Parse BUDGET_USD. Returns null when unset; throws when set but invalid. */
export function readBudgetCap(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.BUDGET_USD?.trim();
  if (!raw) return null;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap < 0) throw new Error(`BUDGET_USD must be a non-negative number, got "${raw}"`);
  return cap;
}

/**
 * A hard monthly spending cap. Before each call we reserve that call's estimated cost; if the
 * reservation would push this month's spend past the cap, the call is not made. After the call,
 * the reservation is swapped for the actual cost. Reservations make this safe with calls in flight.
 */
export class Budget {
  private committed: number;
  private reserved = 0;

  constructor(
    readonly capUsd: number,
    spentUsd: number,
  ) {
    this.committed = spentUsd;
  }

  get spentUsd(): number {
    return this.committed;
  }

  get remainingUsd(): number {
    return this.capUsd - this.committed - this.reserved;
  }

  /** Reserve `estimateUsd`. Returns false (and reserves nothing) if it would exceed the cap. */
  tryReserve(estimateUsd: number): boolean {
    if (this.committed + this.reserved + estimateUsd > this.capUsd) return false;
    this.reserved += estimateUsd;
    return true;
  }

  /** Release a reservation and record what the call actually cost. */
  settle(estimateUsd: number, actualUsd: number): void {
    this.reserved -= estimateUsd;
    this.committed += actualUsd;
  }
}
