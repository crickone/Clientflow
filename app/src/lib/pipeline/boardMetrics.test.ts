/**
 * Pure unit tests for board derivations. No I/O, no DB.
 * Run: npm test -- src/lib/pipeline/boardMetrics.test.ts
 */
import assert from "node:assert/strict";

import { slaTone, isStale, SLA_AMBER_MS, SLA_RED_MS, STALE_MS } from "./boardMetrics";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  passed++;
  console.log("  ✓", name);
}

// slaTone: <15m neutral, 15m–1h amber (inclusive both ends), >1h red
check("0ms → neutral", slaTone(0), "neutral");
check("14m → neutral", slaTone(14 * 60_000), "neutral");
check("15m (boundary) → amber", slaTone(SLA_AMBER_MS), "amber");
check("59m → amber", slaTone(59 * 60_000), "amber");
check("60m (boundary) → amber", slaTone(SLA_RED_MS), "amber");
check("61m → red", slaTone(61 * 60_000), "red");

// isStale: >7d in stage, suppressed for sale/repeat_customer/lost
check("8d in hot_lead → stale", isStale(8 * 86_400_000, "hot_lead"), true);
check("6d in hot_lead → not stale", isStale(6 * 86_400_000, "hot_lead"), false);
check("exactly 7d → not stale (strictly greater)", isStale(STALE_MS, "hot_lead"), false);
check("30d in sale → suppressed", isStale(30 * 86_400_000, "sale"), false);
check("30d in repeat_customer → suppressed", isStale(30 * 86_400_000, "repeat_customer"), false);
check("30d in lost → suppressed", isStale(30 * 86_400_000, "lost"), false);
check("8d in new_lead → stale", isStale(8 * 86_400_000, "new_lead"), true);

// Task 2: computeBoardMetrics
import { computeBoardMetrics, startOfWeekMs, type LeadMetricInput } from "./boardMetrics";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = 1_000_000_000_000; // fixed epoch ms
const weekStart = startOfWeekMs(NOW);

const fixture: LeadMetricInput[] = [
  // L1: this week, contacted 10m after create (speed sample), new_lead
  { createdAt: weekStart + HOUR, updatedAt: weekStart + HOUR, pipelineStage: "new_lead", firstOutboundAt: weekStart + HOUR + 10 * 60_000 },
  // L2: previous week, uncontacted, hot_lead (age > 1h → breaching)
  { createdAt: weekStart - HOUR, updatedAt: weekStart - HOUR, pipelineStage: "hot_lead", firstOutboundAt: null },
  // L3: 100d ago (outside 90d), sale, uncontacted but inactive stage → not counted
  { createdAt: NOW - 100 * DAY, updatedAt: NOW - 100 * DAY, pipelineStage: "sale", firstOutboundAt: null },
  // L4: 15d ago (outside prevWeek), sale (won, within 90d), contacted 1h after create (speed sample)
  { createdAt: NOW - 15 * DAY, updatedAt: NOW - 15 * DAY, pipelineStage: "sale", firstOutboundAt: NOW - 15 * DAY + HOUR },
];

const m = computeBoardMetrics(fixture, NOW);
check("newThisWeek counts only this-week leads", m.newThisWeek, 1);
check("delta = thisWeek - prevWeek", m.newThisWeekDelta, 0);
check("avg speed over 30d samples (10m + 1h)/2", m.avgSpeedToLeadMs, (10 * 60_000 + HOUR) / 2);
check("uncontactedNow excludes inactive stages", m.uncontactedNow, 1);
check("uncontactedBreaching true when any >1h", m.uncontactedBreaching, true);
check("conversion = won/created over 90d (1/3)", m.conversionPct, 33);

const empty = computeBoardMetrics([], NOW);
check("empty → avg null", empty.avgSpeedToLeadMs, null);
check("empty → conversion null", empty.conversionPct, null);
check("empty → not breaching", empty.uncontactedBreaching, false);

console.log(`\n${passed} passed`);
