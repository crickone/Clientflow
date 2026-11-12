// app/src/lib/programs/templates/size.test.ts
// Run: npm test -- src/lib/programs/templates/size.test.ts
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { line, planAt, simulate } from "../simulate";
import type { ExerciseRx } from "../types";

const names = (key: string) => platformProgram(key)!.weeks.map((w) => w.days.map((d) => d.name));

// German Volume Training: 10 x 10 at 60%
const gvt = platformProgram("german-volume-training")!;
const gvtMaxes = { bench: 100, squat: 100 };
const d1 = planAt(gvt, gvtMaxes, 0, 0);
assert.deepEqual(d1.exercises.map((e) => line(e)), ["Bench press 10 x 10 at 60 kg", "Chin-up 10 x 10", "Incline dumbbell fly 3 x 10-12", "Dumbbell row 3 x 10-12"]);
assert.deepEqual(d1.exercises.map((e) => e.joined), [false, true, false, true]);
assert.deepEqual(planAt(gvt, gvtMaxes, 0, 1).exercises.slice(0, 2).map((e) => line(e)), ["Back squat 10 x 10 at 60 kg", "Lying leg curl 10 x 10"]);
assert.equal(d1.exercises[0].sets[0].rest, 90);
const gvtRun = simulate(gvt, { maxes: gvtMaxes });
assert.equal(gvtRun.sessions.length, 18);
assert.equal(gvtRun.final.weights["bench press"], 75);
assert.equal(gvtRun.final.weights["back squat"], 75);

// PHUL
assert.deepEqual(names("phul"), [["Upper power", "Lower power", "Upper hypertrophy", "Lower hypertrophy"]]);
const phul = platformProgram("phul")!;
assert.equal(line(planAt(phul, {}, 0, 0).exercises[0]), "Bench press 4 x 3-5");
assert.equal(line(planAt(phul, {}, 0, 3).exercises[0]), "Front squat 4 x 8-12");
// every rep at the top of the range: +2.5 kg each upper power day from a first 20 kg
assert.equal(simulate(phul, { maxes: {} }).final.weights["bench press@3-5"], 50);

// PHAT
assert.deepEqual(names("phat"), [["Upper power", "Lower power", "Back and shoulders", "Lower hypertrophy", "Chest and arms"]]);
const phat = platformProgram("phat")!;
const speed = planAt(phat, {}, 0, 2).exercises[0];
assert.equal(line(speed), "Pendlay row 6 x 3");
assert.equal(speed.progresses, false);
assert.equal(simulate(phat, { maxes: {} }).final.weights["pendlay row"], undefined, "speed sets never progress");

// PHUL and PHAT rep bands, read from the templates (not through the engine).
/** "Bench press 4 x 3-5": name, sets and the rep range every set shares. */
const row = (e: ExerciseRx) => {
  const bands = e.sets.map((x) => (typeof x.reps === "number" ? `${x.reps}` : `${x.reps.min}-${x.reps.max}`));
  assert.ok(bands.every((b) => b === bands[0]), `${e.name}: one rep range for every set`);
  return `${e.name} ${e.sets.length} x ${bands[0]}`;
};
const rows = (key: string, d: number) => platformProgram(key)!.weeks[0].days[d].exercises.map(row);
const range = (e: ExerciseRx) => {
  const r = e.sets[0].reps;
  return typeof r === "number" ? { min: r, max: r } : r;
};
assert.deepEqual(rows("phul", 0), [
  "Bench press 4 x 3-5",
  "Incline dumbbell press 3 x 6-10",
  "Barbell row 4 x 3-5",
  "Lat pulldown 3 x 6-10",
  "Overhead press 3 x 5-8",
  "Barbell curl 3 x 6-10",
  "Skull crusher 3 x 6-10",
]);
assert.deepEqual(rows("phul", 1), ["Back squat 4 x 3-5", "Deadlift 4 x 3-5", "Leg press 5 x 10-15", "Lying leg curl 4 x 6-10", "Standing calf raise 4 x 6-10"]);
assert.deepEqual(rows("phul", 2), [
  "Incline bench press 4 x 8-12",
  "Dumbbell fly 4 x 8-12",
  "Seated cable row 4 x 8-12",
  "Dumbbell row 4 x 8-12",
  "Lateral raise 4 x 8-12",
  "Incline dumbbell curl 4 x 8-12",
  "Triceps pushdown 4 x 8-12",
]);
assert.deepEqual(rows("phul", 3), [
  "Front squat 4 x 8-12",
  "Walking lunge 4 x 8-12",
  "Leg extension 4 x 10-15",
  "Lying leg curl 4 x 10-15",
  "Seated calf raise 4 x 8-12",
  "Leg press calf raise 4 x 8-12",
]);
// Power days: the main lifts are 3-5, the accessories 6-10 (the overhead press 5-8 and the leg press 10-15 aside).
const power = (key: string) => [0, 1].flatMap((d) => platformProgram(key)!.weeks[0].days[d].exercises);
const heavy = (key: string) => power(key).filter((e) => row(e).endsWith(" x 3-5")).map((e) => e.name);
assert.deepEqual(heavy("phul"), ["Bench press", "Barbell row", "Back squat", "Deadlift"]);
assert.deepEqual(heavy("phat"), ["Pendlay row", "Dumbbell bench press", "Back squat"]);
const accessoryBands = (key: string, aside: string[]) =>
  power(key)
    .filter((e) => !heavy(key).includes(e.name) && !aside.includes(e.name))
    .map((e) => `${range(e).min}-${range(e).max}`);
assert.ok(accessoryBands("phul", ["Overhead press", "Leg press"]).every((b) => b === "6-10"), "PHUL power-day accessories are 6-10");
assert.ok(accessoryBands("phat", ["Stiff-legged deadlift"]).every((b) => b === "6-10"), "PHAT power-day accessories are 6-10");
// Hypertrophy days: PHUL in 8-12 or 10-15; PHAT between 8 and 20 after the speed sets.
for (const d of [2, 3]) for (const e of platformProgram("phul")!.weeks[0].days[d].exercises) assert.ok(["8-12", "10-15"].includes(`${range(e).min}-${range(e).max}`), e.name);
for (const d of [2, 3, 4]) {
  const [first, ...rest] = platformProgram("phat")!.weeks[0].days[d].exercises;
  assert.equal(row(first).endsWith(" 6 x 3"), true, `${first.name} speed sets`);
  for (const e of rest) assert.ok(range(e).min >= 8 && range(e).max <= 20, `${e.name} ${range(e).min}-${range(e).max}`);
}

// German Volume Training: every exercise without a max tells the member how to pick a weight.
for (const d of gvt.weeks[0].days)
  for (const e of d.exercises) {
    if (e.lift) continue;
    assert.ok(e.notes && /Pick a weight|band or the assisted machine/.test(e.notes), `${d.name}: ${e.name} says how to pick a weight`);
  }
const gvtNote = (name: string) => gvt.weeks[0].days.flatMap((d) => d.exercises).find((e) => e.name === name)!.notes!;
assert.ok(gvtNote("Chin-up").includes("Use a band or the assisted machine"));
assert.ok(gvtNote("Dip").includes("Use a band or the assisted machine"));

// Arnold-style split, push/pull/legs, HIT-style
assert.deepEqual(names("arnold-style-split"), [["Chest and back", "Shoulders and arms", "Legs", "Chest and back", "Shoulders and arms", "Legs"]]);
assert.deepEqual(names("push-pull-legs"), [["Push", "Pull", "Legs", "Push", "Pull", "Legs"]]);
assert.deepEqual(names("hit-style-full-body"), [["Workout A", "Workout B", "Workout A"], ["Workout B", "Workout A", "Workout B"]]);
const hit = platformProgram("hit-style-full-body")!;
assert.ok(hit.weeks.every((w) => w.days.every((d) => d.exercises.every((e) => e.sets.length === 1))), "HIT is one work set per exercise");
assert.equal(line(planAt(hit, {}, 0, 0).exercises[0]), "Leg press 1 x 8-12");

for (const key of ["phul", "phat", "arnold-style-split", "push-pull-legs", "hit-style-full-body"]) {
  const t = platformProgram(key)!;
  assert.equal(t.engine.key, "double_progression", key);
  assert.deepEqual(t.lifts, [], `${key} needs no maxes`);
  assert.equal(t.family, "size", key);
}

console.log("programs/templates/size: ok");
