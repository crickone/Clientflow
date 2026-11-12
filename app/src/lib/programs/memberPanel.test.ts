// Run: npm test -- src/lib/programs/memberPanel.test.ts
//
// The client page shows a member-built program read-only: "Built by the
// member", and every week, day and exercise with its rule in plain words.
import assert from "node:assert/strict";

import { initState } from "./engines";
import { blankMemberTemplate } from "./memberTemplate";
import { describeRule, panelFrom } from "./panel";
import { planSession } from "./planner";
import type { ExerciseRx, ProgramTemplate } from "./types";

const squat: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }, { kind: "amrap", pct: 0.85, reps: 3, rest: 180 }], rule: { kind: "percent" } };
const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }, { kind: "fixed", reps: 5, rest: 120 }, { kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3 } };
const row: ExerciseRx = { name: "Cable row", joined: true, sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range" } };
const press: ExerciseRx = { name: "Incline dumbbell press", sets: [{ kind: "rpe", rpe: 8, reps: 8, rest: 120 }], rule: { kind: "rpe" } };
const curl: ExerciseRx = { name: "Hammer curl", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual" } };

// ── each rule in a line ──
assert.equal(describeRule(bench, "kg"), "Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after 3 misses in a row.");
assert.equal(describeRule({ ...bench, rule: { kind: "linear", incKg: 2.5, deloadAfter: 1 } }, "kg"), "Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after a miss.");
assert.equal(describeRule(row, "kg"), "Rep range. 1 x 8-12. Adds the smallest jump when every set reaches the top.");
assert.equal(describeRule({ ...row, rule: { kind: "range", incKg: 5 } }, "lb"), "Rep range. 1 x 8-12. Adds 11 lb when every set reaches the top.");
assert.equal(describeRule(squat, "kg"), "Percent of max. 1 x 3 at 80%, then 1 x 3+ at 85% of the squat max.");
assert.equal(describeRule(press, "kg"), "RPE. 1 x 8 at RPE 8. Weight from the best logged set.");
assert.equal(describeRule(curl, "kg"), "Manual. 1 x 10. The member picks the weight.");

// ── the panel ──
const t: ProgramTemplate = {
  ...blankMemberTemplate(),
  key: "member:4",
  name: "Strength block",
  lifts: ["squat"],
  weeks: [
    { days: [{ name: "Upper", exercises: [bench, row] }, { name: "Lower", exercises: [squat, press, curl] }] },
    { label: "Deload", days: [{ name: "Test", exercises: [squat], test: true }] },
  ],
};
const state = initState(t, { squat: 150 }, 2.5);
const data = panelFrom({ enrolment: { id: 1, status: "active", template: t, state, unit: "kg", basedOnName: null, memberBuilt: true }, plan: planSession(t, state, { stepKg: 2.5 }), events: [], past: [] });
const live = data.live!;
assert.equal(live.byline, "Built by the member");
assert.deepEqual(
  live.program!.map((w) => w.title),
  ["Week 1", "Week 2: Deload"],
);
assert.deepEqual(live.program![0].days[0], {
  name: "Upper",
  lines: [
    "Bench press: Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after 3 misses in a row.",
    "Cable row, superset with the one above: Rep range. 1 x 8-12. Adds the smallest jump when every set reaches the top.",
  ],
});
assert.equal(live.program![1].days[0].name, "Test (test day)");
assert.equal(live.weeks.length, 2, "the coach can still move the member to a week");
assert.equal(live.lifts[0].max, "150 kg");

// ── a library program has no read-only program block ──
const lib = panelFrom({ enrolment: { id: 2, status: "active", template: t, state, unit: "kg", basedOnName: null }, plan: null, events: [], past: [] });
assert.equal(lib.live!.program, null);
assert.equal(lib.live!.byline, "Built by the member", "the author line of a member template");

console.log("programs/memberPanel: ok");
