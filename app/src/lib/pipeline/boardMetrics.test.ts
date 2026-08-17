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

// isStale: >7d in stage, suppressed for won/repeat/lost
check("8d in engaged → stale", isStale(8 * 86_400_000, "engaged"), true);
check("6d in engaged → not stale", isStale(6 * 86_400_000, "engaged"), false);
check("exactly 7d → not stale (strictly greater)", isStale(STALE_MS, "engaged"), false);
check("30d in won → suppressed", isStale(30 * 86_400_000, "won"), false);
check("30d in repeat → suppressed", isStale(30 * 86_400_000, "repeat"), false);
check("30d in lost → suppressed", isStale(30 * 86_400_000, "lost"), false);
check("8d in new → stale", isStale(8 * 86_400_000, "new"), true);

// Task 2: computeBoardMetrics
import { computeBoardMetrics, startOfWeekMs, type LeadMetricInput } from "./boardMetrics";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = 1_000_000_000_000; // fixed epoch ms
const weekStart = startOfWeekMs(NOW);

const fixture: LeadMetricInput[] = [
  // L1: this week, contacted 10m after create (speed sample), new
  { createdAt: weekStart + HOUR, updatedAt: weekStart + HOUR, role: "new", firstOutboundAt: weekStart + HOUR + 10 * 60_000 },
  // L2: previous week, uncontacted, engaged (age > 1h → breaching)
  { createdAt: weekStart - HOUR, updatedAt: weekStart - HOUR, role: "engaged", firstOutboundAt: null },
  // L3: 100d ago (outside 90d), won, uncontacted but inactive stage → not counted
  { createdAt: NOW - 100 * DAY, updatedAt: NOW - 100 * DAY, role: "won", firstOutboundAt: null },
  // L4: 15d ago (outside prevWeek), won (within 90d), contacted 1h after create (speed sample)
  { createdAt: NOW - 15 * DAY, updatedAt: NOW - 15 * DAY, role: "won", firstOutboundAt: NOW - 15 * DAY + HOUR },
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

// Boundary coverage (Task 2 review): bracket the strict thresholds, mirroring
// Task 1's boundary rigor. Each uses a focused single-lead fixture.
const breachAtThreshold: LeadMetricInput = { createdAt: NOW - 60 * 60_000, updatedAt: NOW - 60 * 60_000, role: "engaged", firstOutboundAt: null };
check("uncontacted at exactly 1h → NOT breaching (strict >)", computeBoardMetrics([breachAtThreshold], NOW).uncontactedBreaching, false);
const breachPastThreshold: LeadMetricInput = { createdAt: NOW - 60 * 60_000 - 1, updatedAt: NOW - 60 * 60_000 - 1, role: "engaged", firstOutboundAt: null };
check("uncontacted at 1h+1ms → breaching", computeBoardMetrics([breachPastThreshold], NOW).uncontactedBreaching, true);

const atWeekStart: LeadMetricInput = { createdAt: weekStart, updatedAt: weekStart, role: "new", firstOutboundAt: null };
check("createdAt exactly weekStart → this week (inclusive)", computeBoardMetrics([atWeekStart], NOW).newThisWeek, 1);
const atPrevWeekStart: LeadMetricInput = { createdAt: weekStart - 7 * DAY, updatedAt: weekStart - 7 * DAY, role: "new", firstOutboundAt: null };
check("createdAt exactly prevWeekStart → prev week, delta -1", computeBoardMetrics([atPrevWeekStart], NOW).newThisWeekDelta, -1);

const atCutoff30: LeadMetricInput = { createdAt: NOW - 30 * DAY, updatedAt: NOW - 30 * DAY, role: "new", firstOutboundAt: NOW - 30 * DAY + HOUR };
check("speed sample at exactly 30d cutoff → included", computeBoardMetrics([atCutoff30], NOW).avgSpeedToLeadMs, HOUR);
const beforeCutoff30: LeadMetricInput = { createdAt: NOW - 30 * DAY - 1, updatedAt: NOW - 30 * DAY - 1, role: "new", firstOutboundAt: NOW - 30 * DAY - 1 + HOUR };
check("speed sample just before 30d cutoff → excluded (null)", computeBoardMetrics([beforeCutoff30], NOW).avgSpeedToLeadMs, null);

const atCutoff90Won: LeadMetricInput = { createdAt: NOW - 90 * DAY, updatedAt: NOW - 90 * DAY, role: "won", firstOutboundAt: null };
check("won lead at exactly 90d cutoff → counted (100%)", computeBoardMetrics([atCutoff90Won], NOW).conversionPct, 100);
const beforeCutoff90Won: LeadMetricInput = { createdAt: NOW - 90 * DAY - 1, updatedAt: NOW - 90 * DAY - 1, role: "won", firstOutboundAt: null };
check("won lead just before 90d cutoff → excluded (null)", computeBoardMetrics([beforeCutoff90Won], NOW).conversionPct, null);

console.log(`\n${passed} passed`);
