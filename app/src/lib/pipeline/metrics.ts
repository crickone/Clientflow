/**
 * Thin now-injecting wrapper: maps already-loaded board leads → the pure
 * computeBoardMetrics. Kept separate from boardMetrics.ts so the pure logic
 * stays DB/clock-free and unit-testable. The page loads leads ONCE and passes
 * them here, so metrics add no extra query.
 */
import type { LeadWithSla } from "@/lib/leads";
import { computeBoardMetrics, type BoardMetrics, type LeadMetricInput } from "./boardMetrics";

export function boardMetricsFromLeads(leads: LeadWithSla[], since: number | null = null): BoardMetrics {
  const input: LeadMetricInput[] = leads.map((l) => ({
    createdAt: l.createdAt.getTime(),
    updatedAt: l.updatedAt.getTime(),
    role: l.stage?.role ?? null,
    firstOutboundAt: l.firstOutboundAt,
    imported: l.source === "gohighlevel",
  }));
  return computeBoardMetrics(input, Date.now(), since);
}
