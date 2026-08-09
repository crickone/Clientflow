import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { estCostCents, type Usage } from "./client";

/**
 * Central per-tenant AI spend metering + hard cap. Every agent call records
 * its token usage here (ai_usage table, control DB) so the platform can see
 * — and eventually bill — cross-gym AI spend from one place. Callers should
 * check `assertUnderCap()` BEFORE making a paid model call, then `recordUsage()`
 * after, so a tenant can't blow through the cap mid-request.
 */

export const MONTHLY_CAP_CENTS = 2500; // $25/gym/month — the DEFAULT; see getTenantCapCents for the per-tenant override (Batch 3bc, Theme C4)

/** Admin-settable bounds (Batch 3bc, C4) for a tenant's monthly AI cap — enforced by `setTenantCapCents` itself so every caller (form action, script, test) gets the same guarantee, not just the UI layer. */
export const MIN_CAP_CENTS = 100; // €1
export const MAX_CAP_CENTS = 100_000; // €1000

export class AiCapError extends Error {
  constructor() {
    super(
      // Batch 3bc (C4): this used to point at a cap that didn't exist
      // anywhere in the UI ("raise it in Settings" — there was no such
      // control). Now that one really exists (CapEditor, on the Agents
      // overview), the message points AT it instead of a dead end.
      "This month's AI usage limit has been reached. It resets next month, or an admin can raise the cap from the Agents page.",
    );
    this.name = "AiCapError";
  }
}

function currentMonth(): string {
  // UTC month bucket, e.g. '2026-08'. (Date.now is fine in app runtime; only
  // workflow scripts forbid it.)
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Record one agent call's token usage + estimated cost against a tenant's monthly bucket. */
export function recordUsage(
  tenantId: number,
  agentKey: string,
  model: string,
  u: Usage,
): void {
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

/** Throws AiCapError when the tenant is at/over ITS configured monthly AI spend cap (`getTenantCapCents` — defaults to `MONTHLY_CAP_CENTS` when never customized). */
export function assertUnderCap(tenantId: number): void {
  if (getMonthlyUsageCents(tenantId) >= getTenantCapCents(tenantId)) throw new AiCapError();
}
