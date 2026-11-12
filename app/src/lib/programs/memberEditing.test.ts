// Run: npm test -- src/lib/programs/memberEditing.test.ts
//
// The builder's helpers: switching rules keeps what still makes sense, week
// changes keep their origins in step, days and exercises move and go.
import assert from "node:assert/strict";

import { addDay, addSet, addWeek, applyRule, defaultIncKg, draftFrom, guessLift, moveDay, moveExercise, moveWeek, newExercise, removeDay, removeExercise, removeWeek, setRest } from "./memberEditing";
import { blankMemberTemplate, validateMemberTemplate } from "./memberTemplate";
import type { ExerciseRx } from "./types";

// ── defaults ──
assert.equal(defaultIncKg("Deadlift"), 5);
assert.equal(defaultIncKg("Romanian deadlift"), 5);
assert.equal(defaultIncKg("Bench press"), 2.5);
assert.equal(guessLift("Squat"), "squat", "an alias of Back squat");
assert.equal(guessLift("Bench press"), "bench");
assert.equal(guessLift("Pause deadlift"), "deadlift");
assert.equal(guessLift("Push press"), "press");
assert.equal(guessLift("Leg extension"), "squat");
const fresh = newExercise("Deadlift");
assert.deepEqual(fresh.rule, { kind: "linear", incKg: 5, deloadAfter: 3 });
assert.equal(fresh.sets.length, 3);

// ── every rule from every rule passes the member check ──
const kinds = ["linear", "range", "percent", "rpe", "manual"] as const;
for (const from of kinds) {
  for (const to of kinds) {
    const ex = applyRule(applyRule(newExercise("Bench press"), from), to);
    assert.equal(ex.rule!.kind, to);
    const t = blankMemberTemplate();
    t.weeks[0].days[0].exercises.push(ex);
    const r = validateMemberTemplate(t, "member:1");
    assert.ok(r.ok, `${from} to ${to}: ${r.ok ? "" : r.errors.join(" | ")}`);
  }
}

// ── what a switch keeps ──
const linear: ExerciseRx = { name: "Bench press", notes: "Pause.", joined: true, sets: [{ kind: "fixed", reps: 5, rest: 150 }, { kind: "fixed", reps: 3, rest: 150 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 80 } };
const range = applyRule(linear, "range");
assert.deepEqual(range.sets, [{ kind: "fixed", reps: { min: 5, max: 9 }, rest: 150 }, { kind: "fixed", reps: { min: 3, max: 7 }, rest: 150 }]);
assert.deepEqual(range.rule, { kind: "range", startKg: 80 }, "the start weight comes along");
assert.equal(range.notes, "Pause.");
assert.equal(range.joined, true);
const pct = applyRule(linear, "percent");
assert.equal(pct.lift, "bench");
assert.deepEqual(pct.sets.map((s) => s.kind === "pct" && [s.pct, s.reps]), [[0.75, 5], [0.75, 3]]);
assert.deepEqual(applyRule(pct, "manual").rule, { kind: "manual" }, "percent has no start weight to carry");
const rpe = applyRule(range, "rpe");
assert.deepEqual(rpe.sets.map((s) => s.kind === "rpe" && [s.rpe, s.reps]), [[8, 5], [8, 3]]);
assert.equal(applyRule(linear, "linear"), linear, "the same rule changes nothing");
const manualRange = applyRule(range, "manual");
assert.deepEqual(manualRange.sets[0], { kind: "fixed", reps: { min: 5, max: 9 }, rest: 150 }, "manual keeps a rep range");

// ── sets ──
const ex = newExercise("Back squat");
addSet(ex);
assert.equal(ex.sets.length, 4);
setRest(ex, 2000);
assert.ok(ex.sets.every((s) => s.rest === 900));

// ── weeks keep their origins ──
const t = blankMemberTemplate();
t.weeks[0].days[0].exercises.push(newExercise("Bench press"));
t.weeks.push(structuredClone(t.weeks[0]));
const d = draftFrom(t, true);
assert.deepEqual(d.origins, [0, 1]);
assert.deepEqual(draftFrom(t, false).origins, [null, null]);
assert.equal(addWeek(d, 0), 1);
assert.deepEqual(d.origins, [0, null, 1]);
assert.equal(d.template.weeks.length, 3);
d.template.weeks[1].days[0].name = "Deload";
assert.equal(d.template.weeks[0].days[0].name, "Day 1", "the copy is its own");
assert.ok(moveWeek(d, 2, -1));
assert.deepEqual(d.origins, [0, 1, null]);
assert.equal(d.template.weeks[2].days[0].name, "Deload");
assert.equal(moveWeek(d, 0, -1), false);
removeWeek(d, 0);
assert.deepEqual(d.origins, [1, null]);
removeWeek(d, 0);
removeWeek(d, 0);
assert.equal(d.template.weeks.length, 1, "the last week stays");

// ── days and exercises ──
const p = blankMemberTemplate();
addDay(p, 0);
assert.deepEqual(p.weeks[0].days.map((x) => x.name), ["Day 1", "Day 2"]);
p.weeks[0].days[0].exercises.push(newExercise("Bench press"), { ...newExercise("Dumbbell row"), joined: true });
assert.ok(moveDay(p, 0, 0, 1));
assert.deepEqual(p.weeks[0].days.map((x) => x.name), ["Day 2", "Day 1"]);
assert.ok(moveExercise(p, 0, 1, 1, -1));
assert.equal(p.weeks[0].days[1].exercises[0].name, "Dumbbell row");
assert.equal(p.weeks[0].days[1].exercises[0].joined, undefined, "the first exercise joins nothing");
removeExercise(p, 0, 1, 0);
assert.deepEqual(p.weeks[0].days[1].exercises.map((x) => x.name), ["Bench press"]);
removeDay(p, 0, 0);
removeDay(p, 0, 0);
assert.equal(p.weeks[0].days.length, 1, "the last day stays");

// ── final wave: NaN rest, bad indexes, no shared sets ──
const rested = newExercise("Bench press");
setRest(rested, 90);
setRest(rested, Number.NaN);
assert.ok(rested.sets.every((x) => x.rest === 90), "NaN rest changes nothing");
setRest(rested, Number.POSITIVE_INFINITY);
assert.ok(rested.sets.every((x) => x.rest === 90), "Infinity rest changes nothing");

const idx = blankMemberTemplate();
idx.weeks[0].days[0].exercises = [newExercise("Bench press"), newExercise("Back squat")];
const idxDraft = draftFrom(idx, true);
const snapshot = JSON.stringify(idxDraft);
assert.equal(addWeek(idxDraft, -1), -1);
assert.equal(addWeek(idxDraft, 5), -1);
removeWeek(idxDraft, -1);
assert.equal(moveWeek(idxDraft, -1, 1), false);
addDay(idx, -1);
addDay(idx, 3);
removeDay(idx, 0, -1);
removeDay(idx, -1, 0);
assert.equal(moveDay(idx, 4, 0, 1), false);
assert.equal(moveExercise(idx, 0, 9, 0, 1), false);
assert.equal(moveExercise(idx, 0, 0, -1, 1), false);
removeExercise(idx, 0, 0, -1);
removeExercise(idx, 0, 0, 7);
removeExercise(idx, 0, 4, 0);
removeExercise(idx, 0, 0, 0.5);
assert.equal(JSON.stringify(idxDraft), snapshot, "negative or out-of-range indexes change nothing");

const pctEx: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 5, rest: 180 }], rule: { kind: "percent" } };
const toPct = applyRule({ ...pctEx, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3 } }, "percent");
assert.notEqual(toPct.sets[0], pctEx.sets[0], "a kept pct set is a copy");
const rpeEx: ExerciseRx = { name: "Bench press", sets: [{ kind: "rpe", rpe: 8, reps: 5, rest: 120 }], rule: { kind: "manual" } };
const toRpe = applyRule(rpeEx, "rpe");
assert.notEqual(toRpe.sets[0], rpeEx.sets[0], "a kept rpe set is a copy");
toRpe.sets[0].rest = 30;
assert.equal(rpeEx.sets[0].rest, 120, "editing the new set leaves the old one alone");
const rangeEx: ExerciseRx = { name: "Cable row", sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range" } };
const toManual = applyRule(rangeEx, "manual");
assert.notEqual(toManual.sets[0].reps, rangeEx.sets[0].reps, "a kept rep range is a copy");
const backToRange = applyRule({ ...rangeEx, rule: { kind: "manual" } }, "range");
assert.notEqual(backToRange.sets[0].reps, rangeEx.sets[0].reps);

console.log("programs/memberEditing: ok");
