import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * Shared monthly-spend-cap primitives (architecture review, 2026-08-30).
 * `@/lib/ai/usage.ts` (AI spend) and `@/lib/research/spend.ts` (Places/
 * Geocoding research spend) each meter a tenant's spend against a monthly
 * cap, and used to hand-duplicate the same three pieces of plumbing to do
 * it. Everything else about the two meters is a REAL product difference and
 * stays local to each file: usage.ts's credits/margin/ledger overflow layer
 * (chargeOverflow, meterAndCharge, prepaid AI credits) has no analog here;
 * spend.ts's one-row-per-(tenant,month) upsert accumulator is a different
 * storage shape from ai_usage's insert-a-row-per-call + SUM-on-read ledger.
 * This module holds only the genuinely-identical slice:
 *   1. the current-month bucket key
 *   2. the per-tenant cap "row, else a default" read-through
 *   3. the "throw once spend has reached the cap" assertion
 */

/**
 * UTC month bucket, e.g. "2026-08" — the shared key both meters bucket
 * spend by, so the two meters' month keys are always in lockstep.
 * (Date.now is fine in app runtime; only workflow scripts forbid it.)
 */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Per-tenant cap read-through: looks up `tenantId`'s row in `table` — a
 * control-plane table shaped `(tenant_id INTEGER PRIMARY KEY, cap_cents
 * INTEGER NOT NULL, ...)`, e.g. `tenant_ai_cap` / `tenant_research_cap` (see
 * `ensureControlTables` in @/lib/db/control) — and returns its `cap_cents`,
 * or `defaultCents` when the tenant has never customized it (no row: both
 * tables are deliberately sparse-override). `table` is interpolated
 * directly into the SQL text — safe ONLY because every call site passes a
 * hardcoded literal, never anything derived from user input; SQLite has no
 * parameter binding for identifiers, only values.
 */
export function readTenantCapCents(
  table: string,
  tenantId: number,
  defaultCents: number,
): number {
  const row = controlSqlite
    .prepare(`SELECT cap_cents FROM ${table} WHERE tenant_id = ?`)
    .get(tenantId) as { cap_cents: number } | undefined;
  return row?.cap_cents ?? defaultCents;
}

/**
 * The shared hard-cap gate shape: throws `makeError()` once `spentCents` has
 * reached (or passed) `capCents` — trips at `>=`, not just `>`, so a call
 * that lands exactly on the cap is still the last one allowed through.
 * Callers supply their own error factory (`AiCapError` / `ResearchCapError`)
 * so the thrown type — and its default message — stays theirs.
 */
export function assertUnderMonthlyCap(
  spentCents: number,
  capCents: number,
  makeError: () => Error,
): void {
  if (spentCents >= capCents) throw makeError();
}
