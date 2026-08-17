/**
 * Pure tests for stage invariants (no DB). Run: npm test -- src/lib/pipeline/stageInvariants.test.ts
 */
import assert from "node:assert/strict";
import { resolveEntryStage, canDeleteStage, roleConflict, type StageRecord } from "./roles";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
  console.log("  ✓", name);
}

const mk = (id: number, position: number, role: StageRecord["role"], name = `S${id}`): StageRecord =>
  ({ id, name, colour: "#8b949e", position, role });

const stages = [mk(10, 0, "new"), mk(11, 1, "engaged"), mk(12, 2, null)];

check("entry stage = the role:new stage", resolveEntryStage(stages)?.id, 10);
check("entry falls back to lowest position when no role:new", resolveEntryStage([mk(20, 3, null), mk(21, 1, null)])?.id, 21);
check("entry of empty list is null", resolveEntryStage([]), null);

check("can delete a non-last stage", canDeleteStage(stages, 11), { ok: true });
check("cannot delete the last remaining stage", canDeleteStage([mk(30, 0, "new")], 30), { ok: false, reason: "A pipeline needs at least one stage." });

check("role conflict finds the holder", roleConflict(stages, "engaged", null)?.id, 11);
check("role conflict ignores the excepted id (self-edit)", roleConflict(stages, "engaged", 11), null);
check("no conflict for an unused role", roleConflict(stages, "won", null), null);

check("entry fallback skips a lower-position lost stage for a funnel stage", resolveEntryStage([mk(1, 0, "lost"), mk(2, 1, null)])?.id, 2);
check("entry fallback: role:new wins even at a non-lowest position", resolveEntryStage([mk(1, 5, "new"), mk(2, 0, "engaged")])?.id, 1);
check("entry fallback: all out-of-band → still returns the lowest position (no crash)", resolveEntryStage([mk(1, 3, "lost"), mk(2, 1, "lapsed")])?.id, 2);

console.log(`\n${passed} passed`);
