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

export const MONTHLY_CAP_CENTS = 2500; // $25/gym/month

export class AiCapError extends Error {
  constructor() {
    super(
      "This month's AI usage limit has been reached. It resets next month, or raise the cap in Settings.",
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

/** Throws AiCapError when the tenant is at/over its monthly AI spend cap. */
export function assertUnderCap(tenantId: number): void {
  if (getMonthlyUsageCents(tenantId) >= MONTHLY_CAP_CENTS) throw new AiCapError();
}
