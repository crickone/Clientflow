import "server-only";

import { and, gte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { controlSqlite } from "@/lib/db/control";
import { getMonthlyUsageByAgent, getMonthlyUsageByModel, getMonthlyUsageCents, getTenantCapCents, isOverFreeTranche } from "@/lib/ai/usage";
import type { UsageRow } from "./ai";

/** The ledger's month bucket ("YYYY-MM", UTC, like currentMonthKey) at an instant. */
export function monthKeyAt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export function spentThisMonth(tenantId: number, yyyymm: string): number {
  return getMonthlyUsageCents(tenantId, yyyymm);
}

export function capCents(tenantId: number): number {
  return getTenantCapCents(tenantId);
}

export function overAllowance(tenantId: number): boolean {
  return isOverFreeTranche(tenantId);
}

export function usageByAgent(tenantId: number, yyyymm: string): Record<string, number> {
  return getMonthlyUsageByAgent(tenantId, yyyymm);
}

export function usageByModel(tenantId: number, yyyymm: string): { model: string; cents: number }[] {
  return getMonthlyUsageByModel(tenantId, yyyymm);
}

/** Every usage row of the month (one query; the daily, driver and media widgets group it in JS). */
export function usageRows(tenantId: number, yyyymm: string): (UsageRow & { ms: number })[] {
  const rows = controlSqlite
    .prepare("SELECT agent_key, model, cost_cents, created_at FROM ai_usage WHERE tenant_id = ? AND yyyymm = ?")
    .all(tenantId, yyyymm) as { agent_key: string; model: string; cost_cents: number; created_at: number }[];
  return rows.map((r) => ({ agent: r.agent_key, model: r.model, cents: r.cost_cents, ms: r.created_at }));
}

/** Agent runs created at or after `fromMs` and before `toMs`, with how many ended in error. */
export function agentRunCounts(fromMs: number, toMs: number): { total: number; errors: number } {
  const R = schema.agentRuns;
  const row = db
    .select({ total: sql<number>`count(*)`, errors: sql<number>`coalesce(sum(case when ${R.status} = 'error' then 1 else 0 end), 0)` })
    .from(R)
    .where(and(gte(R.createdAt, new Date(fromMs)), sql`${R.createdAt} < ${toMs}`))
    .get();
  return { total: Number(row?.total ?? 0), errors: Number(row?.errors ?? 0) };
}

