/**
 * Unit test for the pure forward-only stage logic. No I/O.
 * Run: npx tsx src/lib/pipeline/stages.test.ts
 */
import assert from "node:assert/strict";

import { nextAutoStage } from "./stages";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  passed++;
  console.log("  ✓", name);
}

check("new_lead → hot_lead advances", nextAutoStage("new_lead", "hot_lead"), "hot_lead");
check("hot_lead → new_lead does NOT regress", nextAutoStage("hot_lead", "new_lead"), null);
check(
  "existing customer reply stays sale (sale → hot_lead = no-op)",
  nextAutoStage("sale", "hot_lead"),
  null,
);
check("consultation_booked → no_show advances", nextAutoStage("consultation_booked", "no_show"), "no_show");
check("no_show → attended advances (no-show who shows up)", nextAutoStage("no_show", "attended"), "attended");
check("sale → repeat_customer advances", nextAutoStage("sale", "repeat_customer"), "repeat_customer");
check("same stage is a no-op (idempotent)", nextAutoStage("consultation_booked", "consultation_booked"), null);
check("lost is frozen against auto (lost → hot_lead)", nextAutoStage("lost", "hot_lead"), null);
check("lost is frozen even forward (lost → sale)", nextAutoStage("lost", "sale"), null);
check("lapsed customer re-pays → repeat_customer advances", nextAutoStage("lapsed", "repeat_customer"), "repeat_customer");

console.log(`\npipeline stages: ${passed} checks passed.`);
