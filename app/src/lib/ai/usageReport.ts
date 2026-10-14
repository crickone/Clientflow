import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { currentMonthKey } from "@/lib/monthlyCap";
import { getAiBalanceCents } from "./creditsLedger";
import { getTenantCapCents } from "./usage";
import { byFeature, groupActivity, type ActivityGroup, type FeatureTotal, type UsageRow } from "./usageReportModel";

/**
 * One month of an account's AI spend, for its AI usage page
 * (/settings/usage): the total against the included monthly allowance, the
 * split by feature, and each piece of work it went on. Raw estimated cost,
 * the same figure the free allowance is measured in (lib/ai/usage.ts).
 */
export type UsageReport = {
  month: string;
  months: { month: string; cents: number }[];
  totalCents: number;
  calls: number;
  allowanceCents: number;
  creditCents: number;
  features: FeatureTotal[];
  activity: ActivityGroup[];
};

export function getUsageReport(tenantId: number, month?: string | null): UsageReport {
  const current = currentMonthKey();
  const months = controlSqlite
    .prepare("SELECT yyyymm AS month, COALESCE(SUM(cost_cents),0) AS cents FROM ai_usage WHERE tenant_id = ? GROUP BY yyyymm ORDER BY yyyymm DESC LIMIT 12")
    .all(tenantId) as { month: string; cents: number }[];
  if (!months.some((m) => m.month === current)) months.unshift({ month: current, cents: 0 });
  const chosen = month && /^\d{4}-\d{2}$/.test(month) && months.some((m) => m.month === month) ? month : current;

  const rows = (
    controlSqlite
      .prepare("SELECT created_at, agent_key, cost_cents, ref, label FROM ai_usage WHERE tenant_id = ? AND yyyymm = ? ORDER BY created_at")
      .all(tenantId, chosen) as { created_at: number; agent_key: string; cost_cents: number; ref: string | null; label: string | null }[]
  ).map((r): UsageRow => ({ at: r.created_at, agentKey: r.agent_key, cents: r.cost_cents, ref: r.ref, label: r.label }));

  return {
    month: chosen,
    months,
    totalCents: rows.reduce((s, r) => s + r.cents, 0),
    calls: rows.length,
    allowanceCents: getTenantCapCents(tenantId),
    creditCents: getAiBalanceCents(tenantId),
    features: byFeature(rows),
    activity: groupActivity(rows),
  };
}
