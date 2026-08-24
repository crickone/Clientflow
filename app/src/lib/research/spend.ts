import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * Per-tenant monthly metering + hard cap for RESEARCH spend — Google Places/
 * Geocoding calls (Market Research P1, Task 3). This is the *research*
 * analog of `@/lib/ai/usage.ts`'s AI spend meter: same control-plane
 * storage, same month-key + cap-check contract, integer cents throughout —
 * but a SEPARATE meter with its own table and its own cap, since research
 * spend is a different budget from AI spend and must never share ai_usage's
 * monthly total.
 *
 * The invariant callers must uphold mirrors ai/usage.ts's `assertUnderCap`/
 * `recordUsage` pairing: `assertUnderResearchCap()` runs BEFORE a metered
 * Places/Geocoding call and `recordResearchSpend()` after, so a tenant can't
 * blow through the cap mid-refresh. A call already in flight when the cap
 * trips is allowed to finish (its cost is recorded); only the NEXT call is
 * blocked by the following `assertUnderResearchCap()`.
 *
 * Storage shape deliberately differs from ai_usage's insert-a-row-per-call +
 * SUM-on-read ledger: research spend has no per-call breakdown requirement
 * yet (unlike ai_usage's per-agent/per-model rollups), so `research_usage`
 * is ONE row per (tenant, month) that `recordResearchSpend` upserts straight
 * into — see control.ts's `ensureControlTables` for the table + the
 * `tenant_research_cap` per-tenant cap-override table (getter/read-through
 * only in this task; the setter/admin UI ships in a later task).
 */

export class ResearchCapError extends Error {
  constructor(message = "This tenant's monthly research spend cap has been reached.") {
    super(message);
    this.name = "ResearchCapError";
  }
}

/**
 * Approximate Google Maps Platform LIST prices per call, converted to whole
 * CENTS and rounded to the nearest cent — these exist to CAP spend, not to
 * bill exactly (a real invoice would use Google's own fractional pricing).
 * Source (list price, checked 2026-08, per-1,000-calls -> per-call):
 *   - Geocoding API:            $5 / 1,000  = 0.5c/call  -> rounds to 1c
 *   - Places API Nearby (New):  $32 / 1,000 = 3.2c/call  -> rounds to 3c
 *   - Places API Details (New): $17 / 1,000 = 1.7c/call  -> rounds to 2c
 *   - Meta Ad Library (ads_archive), Market Research P2: FREE -> 0c/call.
 *     Kept in this table (not omitted) purely so recordResearchSpend's
 *     ledger has a uniform row per research API this app calls — refresh.ts
 *     never gates the ad-fetch step behind assertUnderResearchCap BECAUSE
 *     it's free (an unrelated Places-spend cap must never block a €0 call),
 *     and a 0-cent record can never push a tenant over any cap regardless.
 */
export const UNIT_COST_CENTS: { geocode: number; nearby: number; details: number; adlib: number } = {
  geocode: 1,
  nearby: 3,
  details: 2,
  adlib: 0,
};

/** DEFAULT monthly research-spend cap (cents) — €10/tenant/month; see `getResearchCapCents` for the per-tenant override (admin-adjustable, later task). */
export const DEFAULT_RESEARCH_CAP_CENTS = 1000;

function currentMonth(): string {
  // UTC month bucket, e.g. '2026-08' — same format/derivation as ai/usage.ts's
  // currentMonth(), so the two meters' month keys are always in lockstep.
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Total research spend (cents) for a tenant in a given month (defaults to
 * the current month). A month with no `research_usage` row (never spent, or
 * a month that's rolled over) reads as 0 — this is how "new month -> spend
 * resets" falls out naturally, with nothing to reset.
 */
export function researchSpentCents(tenantId: number, month: string = currentMonth()): number {
  const row = controlSqlite
    .prepare("SELECT spent_cents FROM research_usage WHERE tenant_id = ? AND yyyymm = ?")
    .get(tenantId, month) as { spent_cents: number } | undefined;
  return row?.spent_cents ?? 0;
}

/**
 * Reads a tenant's configured monthly research-spend cap (cents) — a
 * primary-key lookup against the control-plane `tenant_research_cap` table
 * (see `ensureControlTables` in @/lib/db/control), the exact same
 * read-through shape as ai/usage.ts's `getTenantCapCents`. Falls back to
 * `DEFAULT_RESEARCH_CAP_CENTS` when the tenant has never customized it (no
 * row) — storing/editing the cap from an admin UI is a LATER task; this is
 * just the default + read-through half.
 */
export function getResearchCapCents(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT cap_cents FROM tenant_research_cap WHERE tenant_id = ?")
    .get(tenantId) as { cap_cents: number } | undefined;
  return row?.cap_cents ?? DEFAULT_RESEARCH_CAP_CENTS;
}

/**
 * The runtime gate every metered Places/Geocoding call passes BEFORE
 * spending. Throws `ResearchCapError` once this month's recorded spend has
 * reached (or passed) the tenant's cap — pre-check contract, matching
 * ai/usage.ts's `assertUnderCap` exactly: called BEFORE the external call,
 * so a call that would push spend over the cap is allowed to complete (its
 * cost recorded afterwards via `recordResearchSpend`), and only the NEXT
 * call is blocked.
 */
export function assertUnderResearchCap(tenantId: number): void {
  if (researchSpentCents(tenantId) >= getResearchCapCents(tenantId)) {
    throw new ResearchCapError();
  }
}

/**
 * Record one metered call's cost against a tenant's current-month
 * `research_usage` bucket (upsert: adds onto the existing total rather than
 * replacing it). `cents` is clamped to >= 0 (and rounded to the nearest
 * whole cent) so a bad caller can never push a tenant's recorded spend
 * negative — negative input is simply a no-op contribution, never a refund.
 * `kind` (e.g. 'geocode' | 'nearby' | 'details', matching `UNIT_COST_CENTS`'
 * keys) identifies which call this was; not persisted by this minimal
 * per-month accumulator (there's no by-kind breakdown requirement yet,
 * unlike ai_usage's per-agent rollup) but accepted so call sites can pass it
 * through uniformly and a future breakdown can be added without an
 * interface change.
 */
export function recordResearchSpend(tenantId: number, cents: number, kind: string): void {
  void kind; // reserved for a future by-kind breakdown; see doc comment above
  const clamped = Math.max(0, Math.round(cents));
  const month = currentMonth();
  controlSqlite
    .prepare(
      `INSERT INTO research_usage (tenant_id, yyyymm, spent_cents, updated_at)
       VALUES (?, ?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id, yyyymm) DO UPDATE
         SET spent_cents = spent_cents + excluded.spent_cents,
             updated_at  = excluded.updated_at`,
    )
    .run(tenantId, month, clamped);
}
