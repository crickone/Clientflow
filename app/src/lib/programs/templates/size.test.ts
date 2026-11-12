// app/src/lib/programs/templates/size.test.ts
// Run: npm test -- src/lib/programs/templates/size.test.ts
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { line, planAt, simulate } from "../simulate";

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
