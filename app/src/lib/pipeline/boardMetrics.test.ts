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

console.log(`\n${passed} passed`);
