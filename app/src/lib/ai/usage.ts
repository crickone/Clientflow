import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { estCostCents, type Usage } from "./client";
import { getAiBalanceCents, isAiSuspended, recordAiSpend, withMargin } from "./creditsLedger";

/**
 * Central per-tenant AI spend metering + hard cap. Every AI call records its
 * token usage here (ai_usage table, control DB) so the platform can see — and
 * eventually bill — cross-gym AI spend from one place. The invariant is:
 * `assertUnderCap()` runs BEFORE a paid model call and `recordUsage()` after,
 * so a tenant can't blow through the cap mid-request.
 *
 * Call sites do NOT call these two directly — they'd be easy to forget, and a
 * forgotten pair silently un-caps a tenant. Instead every paid call flows
 * through one of two chokepoints that pair them for you:
 *   - `meteredCreate` (@/lib/ai/metered)         — one-shot, non-streaming calls
 *   - `runAgentTurn`  (@/lib/agents/runAgentTurn) — the streaming agent loop
 * A CI guard (meteredGuard.test.ts) fails the build if any other file reaches
 * for the raw Anthropic SDK, which is what makes the pairing unskippable.
 */

export const MONTHLY_CAP_CENTS = 2500; // $25/gym/month — the DEFAULT; see getTenantCapCents for the per-tenant override (Batch 3bc, Theme C4)

/** Admin-settable bounds (Batch 3bc, C4) for a tenant's monthly AI cap — enforced by `setTenantCapCents` itself so every caller (form action, script, test) gets the same guarantee, not just the UI layer. */
export const MIN_CAP_CENTS = 100; // €1
export const MAX_CAP_CENTS = 100_000; // €1000

export class AiCapError extends Error {
  // Thrown by `assertAiAllowed` when a tenant is over its monthly free tranche
  // AND has no prepaid AI credits left (or is suspended). Kept named
  // "AiCapError" — not renamed — so the ~10 call sites that already catch it
  // (429 / friendly message / best-effort null) keep working UNCHANGED now that
  // the model has moved from a hard cap to free-tranche-then-prepaid-credits.
  constructor(
    message = "Your monthly free AI allowance is used up and there are no AI credits left. Top up your AI credits, or an admin can add some.",
  ) {
    super(message);
    this.name = "AiCapError";
  }
}

function currentMonth(): string {
  // UTC month bucket, e.g. '2026-08'. (Date.now is fine in app runtime; only
  // workflow scripts forbid it.)
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Record one AI call's token usage against a tenant's monthly `ai_usage` bucket; returns the estimated RAW cost (cents) it recorded — `meterAndCharge` uses that to bill any overflow beyond the free tranche. */
export function recordUsage(
  tenantId: number,
  agentKey: string,
  model: string,
  u: Usage,
): number {
  const cost = estCostCents(model, u);
  controlSqlite
    .prepare(
      `INSERT INTO ai_usage (tenant_id, yyyymm, agent_key, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_cents)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      tenantId,
      currentMonth(),
      agentKey,
      model,
      u.inputTokens,
      u.outputTokens,
      u.cacheReadTokens ?? 0,
      u.cacheCreateTokens ?? 0,
      cost,
    );
  return cost;
}

/** Total estimated spend (cents) for a tenant in a given month (defaults to the current month). */
export function getMonthlyUsageCents(tenantId: number, yyyymm = currentMonth()): number {
  const row = controlSqlite
    .prepare("SELECT COALESCE(SUM(cost_cents),0) c FROM ai_usage WHERE tenant_id = ? AND yyyymm = ?")
    .get(tenantId, yyyymm) as { c: number };
  return row.c;
}

/** Same total, broken down by agent_key — for an operator-facing spend breakdown. */
export function getMonthlyUsageByAgent(
  tenantId: number,
  yyyymm = currentMonth(),
): Record<string, number> {
  const rows = controlSqlite
    .prepare(
      "SELECT agent_key, COALESCE(SUM(cost_cents),0) c FROM ai_usage WHERE tenant_id = ? AND yyyymm = ? GROUP BY agent_key",
    )
    .all(tenantId, yyyymm) as { agent_key: string; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.agent_key, r.c]));
}

/**
 * Same total, broken down by model — an operator-facing spend breakdown that
 * reconciles to `getMonthlyUsageCents` (same rows as `getMonthlyUsageByAgent`,
 * just grouped by `model` instead of `agent_key`). Sorted by cents desc.
 */
export function getMonthlyUsageByModel(
  tenantId: number,
  yyyymm = currentMonth(),
): { model: string; cents: number }[] {
  const rows = controlSqlite
    .prepare(
      "SELECT model, COALESCE(SUM(cost_cents),0) c FROM ai_usage WHERE tenant_id = ? AND yyyymm = ? GROUP BY model ORDER BY c DESC",
    )
    .all(tenantId, yyyymm) as { model: string; c: number }[];
  return rows.map((r) => ({ model: r.model, cents: r.c }));
}

/**
 * Reads a tenant's configured monthly AI spend cap (cents) — a primary-key
 * lookup against the control-plane `tenant_ai_cap` table (see
 * `ensureControlTables` in @/lib/db/control), the same connection + shape as
 * every other per-tenant control read in this file (`ai_usage`). Falls back
 * to the DEFAULT `MONTHLY_CAP_CENTS` when the tenant has never customized it
 * (no row) — this is the ONLY thing that changed from the old hardcoded
 * constant: `assertUnderCap` below, and both agent pages' `capCents` prop,
 * now read THIS instead of the bare constant. Fast enough for the hot path
 * (an indexed PK lookup on every AI call).
 */
export function getTenantCapCents(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT cap_cents FROM tenant_ai_cap WHERE tenant_id = ?")
    .get(tenantId) as { cap_cents: number } | undefined;
  return row?.cap_cents ?? MONTHLY_CAP_CENTS;
}

/**
 * Admin-only setter — called from the Agents page's cap editor action (see
 * `saveCapEur` in @/app/agents/actions). Validates bounds itself, the same
 * reasoning as `updateAgentModel`'s allowlist living in the registry rather
 * than its action: every caller gets the guarantee, not just the one button
 * that happens to call it today.
 */
export function setTenantCapCents(tenantId: number, capCents: number): void {
  if (!Number.isInteger(capCents) || capCents < MIN_CAP_CENTS || capCents > MAX_CAP_CENTS) {
    throw new Error(`Cap must be a whole number of cents between ${MIN_CAP_CENTS} and ${MAX_CAP_CENTS}.`);
  }
  controlSqlite
    .prepare(
      `INSERT INTO tenant_ai_cap (tenant_id, cap_cents, updated_at) VALUES (?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET cap_cents = excluded.cap_cents, updated_at = excluded.updated_at`,
    )
    .run(tenantId, capCents);
}

/**
 * The monthly FREE-TRANCHE predicate: true once a tenant's this-month raw AI
 * spend (`getMonthlyUsageCents`) has reached its tranche size
 * (`getTenantCapCents`, default €25 — the free allowance the operator absorbs).
 * Both `assertAiAllowed` and any UI that shows "free allowance used up" read
 * this one rule.
 */
export function isOverFreeTranche(tenantId: number): boolean {
  return getMonthlyUsageCents(tenantId) >= getTenantCapCents(tenantId);
}

/** The pure free-tranche gate (no credit awareness) — throws AiCapError once the monthly free tranche is used up. Prefer `assertAiAllowed` at call sites; retained for the free-tranche-only checks. */
export function assertUnderCap(tenantId: number): void {
  if (isOverFreeTranche(tenantId)) throw new AiCapError();
}

/**
 * The runtime gate every paid AI call passes BEFORE burning tokens. Allows the
 * call when the tenant is (a) not suspended AND (b) either still inside its
 * monthly free tranche OR holding a positive prepaid AI-credit balance to cover
 * the overflow. Throws `AiCapError` otherwise. Because a €0 balance means "no
 * credits", a tenant that has never topped up behaves EXACTLY like the old hard
 * cap — so this is an inert-by-default replacement for `assertUnderCap`.
 */
export function assertAiAllowed(tenantId: number): void {
  if (isAiSuspended(tenantId)) {
    throw new AiCapError("AI is currently suspended for this account.");
  }
  if (!isOverFreeTranche(tenantId)) return; // still inside the free monthly tranche
  if (getAiBalanceCents(tenantId) > 0) return; // prepaid credits cover the overflow
  throw new AiCapError();
}

/**
 * Record one AI call's usage AND bill any portion beyond the free tranche to
 * the tenant's prepaid credits. Replaces a bare `recordUsage` at the metering
 * chokepoints:
 *   1. `recordUsage` writes the call to `ai_usage` (analytics + tranche tracker)
 *      and returns its raw cost.
 *   2. The slice of that cost lying ABOVE the free tranche is marked up
 *      (`withMargin`, +5%) and debited from the credit balance (`recordAiSpend`).
 * Inside the tranche the overflow is 0 and nothing is debited — so with no
 * credits granted this is a no-op beyond the existing `recordUsage`, matching
 * today's behaviour. `usedBefore` is read BEFORE `recordUsage` so this call
 * isn't counted against its own free-tranche headroom.
 */
export function meterAndCharge(tenantId: number, agentKey: string, model: string, u: Usage): void {
  const trancheCents = getTenantCapCents(tenantId);
  const usedBefore = getMonthlyUsageCents(tenantId);
  const rawCost = recordUsage(tenantId, agentKey, model, u);
  const freeRemaining = Math.max(0, trancheCents - usedBefore);
  const overflowRaw = Math.max(0, rawCost - freeRemaining);
  const billable = withMargin(overflowRaw);
  if (billable > 0) recordAiSpend(tenantId, billable, agentKey);
}
