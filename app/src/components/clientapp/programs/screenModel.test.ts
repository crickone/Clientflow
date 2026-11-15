// app/src/components/clientapp/programs/screenModel.test.ts
// Run: npx tsx src/components/clientapp/programs/screenModel.test.ts
//
// The small decisions the member screens make, and how the training table writes a set.
import assert from "node:assert/strict";
import { liveStripItems, showsNoProgramRow } from "./screenModel";
import { setLine } from "./setLine";

// a stat strip never shows a zero
assert.deepEqual(
  liveStripItems([{ label: "This week", value: "0", sub: "sessions" }, { label: "Streak", value: "0", sub: "weeks" }, null]),
  [],
  "a new member has no strip",
);
assert.deepEqual(
  liveStripItems([{ label: "This week", value: "0/4", sub: "sessions" }, { label: "Streak", value: "0", sub: "weeks" }, { label: "Next class", value: "Today" }]).map((i) => i.label),
  ["This week", "Next class"],
  "0/4 is a count of planned sessions, not a zero",
);

// "No program yet" shows only when nothing runs or is assigned
assert.equal(showsNoProgramRow({ coachPlan: false, assignedPrograms: 0, enrolment: false }), true);
assert.equal(showsNoProgramRow({ coachPlan: false, assignedPrograms: 0, enrolment: true }), false, "a running or paused program of the member's own");
assert.equal(showsNoProgramRow({ coachPlan: true, assignedPrograms: 0, enrolment: false }), false, "a coach plan");
assert.equal(showsNoProgramRow({ coachPlan: false, assignedPrograms: 2, enrolment: false }), false, "assigned programs");

// a drives set is a + set, like an AMRAP one
const set = { kg: 100, reps: 5, repsMax: null, amrap: false, rpe: null, pct: 0.8, rest: 180, drives: false };
assert.equal(setLine(set, "kg"), "100 kg x 5");
assert.equal(setLine({ ...set, amrap: true }, "kg"), "100 kg x 5+");
assert.equal(setLine({ ...set, drives: true }, "kg"), "100 kg x 5+", "a drives set shows the +");
assert.equal(setLine({ ...set, drives: true, amrap: true }, "kg"), "100 kg x 5+", "one + only when it is both");

console.log("programs/screenModel: ok");
