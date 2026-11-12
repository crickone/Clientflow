// app/src/lib/programs/progressionText.test.ts
// Run: npm test -- src/lib/programs/progressionText.test.ts
//
// "How your weights move" for every platform program (kg and lb) and for
// every own rule: plain sentences with the real numbers and nothing undefined.
import assert from "node:assert/strict";

import { applyRule, newExercise } from "./memberEditing";
import { blankMemberTemplate } from "./memberTemplate";
import { howWeightsMove, ruleSentence } from "./progressionText";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import { nsunsStyle } from "./templates/nsuns";
import type { ExerciseRx } from "./types";
import { STEP_5LB_KG } from "./units";

const get = (key: string) => platformProgram(key)!;

assert.deepEqual(howWeightsMove(get("stronglifts-5x5"), "kg", 2.5), [
  "Each lift starts at 50% of your max.",
  "Get every rep on every set and the weight goes up next time: 2.5 kg, or 5 kg on the deadlift.",
  "Miss reps three sessions in a row and that lift drops 10%.",
  "A lift never drops below the empty bar (20 kg).",
]);

// Greyskull's 1.25 kg upper-body jump rounds to the member's smallest jump.
const grey = howWeightsMove(get("greyskull-lp"), "kg", 2.5);
assert.ok(grey.includes("Get every rep on every set and the weight goes up next time: 2.5 kg."), grey.join(" | "));
assert.ok(grey.includes("Ten or more reps on the last set doubles the jump."));
assert.ok(grey.includes("Fall short on any set and that lift drops 10% next time."));
assert.ok(grey.includes("Chin-up is bodyweight. Add reps when you can."));
assert.ok(howWeightsMove(get("greyskull-lp"), "kg", 1.25).includes("Get every rep on every set and the weight goes up next time: 1.25 kg, or 2.5 kg on the squat and deadlift."));
const greyLb = howWeightsMove(get("greyskull-lp"), "lb", STEP_5LB_KG);
assert.ok(greyLb.includes("Get every rep on every set and the weight goes up next time: 5 lb."), greyLb.join(" | "));
assert.ok(greyLb.includes("A lift never drops below the empty bar (45 lb)."));

assert.deepEqual(howWeightsMove(get("531-bbb"), "kg", 2.5), [
  "Your training max is 90% of your max. Every percentage is taken from it.",
  "The last set of each main lift is as many reps as you can.",
  "After each four-week cycle, your training max goes up 2.5 kg, or 5 kg on the deadlift and squat.",
  "If a lift's last set falls short of its reps, is lighter than planned or is not logged, that lift's training max stays the same for the next cycle.",
  "You pick the weight for dumbbell row and lying leg curl. The program does not change it.",
  "Chin-up and hanging leg raise are bodyweight. Add reps when you can.",
]);
// A training max moves by the raw amount, shown in pounds.
assert.ok(howWeightsMove(get("531-bbb"), "lb", STEP_5LB_KG).includes("After each four-week cycle, your training max goes up 5.5 lb, or 11 lb on the deadlift and squat."));

const texas = howWeightsMove(get("texas-method"), "kg", 2.5);
assert.equal(texas[0], "Your training max is your 5-rep max, about 86% of your max. Every percentage is taken from it.");
assert.equal(texas[1], "Get all 5 reps on a top set and that lift's training max goes up 2.5 kg, or 5 kg on the deadlift.");

assert.deepEqual(howWeightsMove(get("gzclp"), "kg", 2.5), [
  "Main lifts (T1) start at 73% of your max and second lifts (T2) at 55%.",
  "Hit every rep and the lift goes up next time: 2.5 kg, or 5 kg on the squat and deadlift.",
  "Miss on a main lift and it moves on to 6 x 2+, then 10 x 1+ at the same weight. Miss on 10 x 1+ and it goes back to 5 x 3+ at 85% of that weight.",
  "Miss on a second lift and it moves on to 3 x 8, then 3 x 6. After 3 x 6 it goes back to 3 x 10, 5 kg heavier than it last started.",
  "Accessories (T3) go up 2.5 kg once the last set reaches 25 reps.",
]);

assert.deepEqual(howWeightsMove(get("smolov-base"), "kg", 2.5), [
  "Every weight is a percentage of the max you enter.",
  "Week 2 adds 10 kg and week 3 adds 15 kg to every set.",
  "The weights are set from the start. They do not change with how a session goes.",
  "The test day reads your new max from your best set. Start the block again from it.",
]);

assert.deepEqual(howWeightsMove(get("phul"), "kg", 1.25), [
  "You pick each starting weight.",
  "When every set reaches the top of its rep range, the weight goes up 1.25 kg and the reps go back to the bottom.",
]);
// PHAT's speed sets share names with lifts that progress on the power days: no line says the program leaves them alone.
assert.ok(!howWeightsMove(get("phat"), "kg", 2.5).some((l) => l.includes("pendlay row")));

const gvt = howWeightsMove(get("german-volume-training"), "kg", 2.5);
assert.equal(gvt[0], "Each lift starts at 60% of your max.");
assert.ok(gvt.includes("Get every rep on every set and the weight goes up 2.5 kg next time. Until then it stays the same."));
assert.ok(gvt.includes("You pick the starting weight for lying leg curl and hammer curl."));

assert.ok(
  howWeightsMove(nsunsStyle, "kg", 2.5).includes("The reps on the heavy + set move your training max: 0 to 1 reps changes nothing, 2 to 3 reps adds 2.5 kg, 4 to 5 reps adds 5 kg and 6 or more reps adds 7.5 kg."),
);

// Every platform program, in kg and in pounds: sentences, no gaps.
for (const t of [...PLATFORM_PROGRAMS, nsunsStyle]) {
  for (const [unit, step] of [["kg", 2.5], ["kg", 1.25], ["lb", STEP_5LB_KG]] as const) {
    const lines = howWeightsMove(t, unit, step);
    assert.ok(lines.length >= 2, `${t.key}: at least two lines`);
    for (const l of lines) {
      assert.ok(!/undefined|NaN|null|\[object/.test(l), `${t.key}: ${l}`);
      assert.ok(/^[A-Z0-9]/.test(l) && l.endsWith("."), `${t.key}: a sentence: ${l}`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(l), `${t.key}: no emojis`);
      if (unit === "lb") assert.ok(!/\bkg\b/.test(l), `${t.key}: pounds only: ${l}`);
    }
  }
}

// ── every own rule ──
const bench = (kind: Parameters<typeof applyRule>[1]): ExerciseRx => applyRule(newExercise("Bench press"), kind);
assert.equal(ruleSentence(newExercise("Back squat"), "kg", 2.5), "Back squat goes up 2.5 kg after a session with every rep, and drops 10% after three misses in a row.");
assert.equal(ruleSentence(newExercise("Deadlift"), "lb", STEP_5LB_KG), "Deadlift goes up 10 lb after a session with every rep, and drops 10% after three misses in a row.");
const oneMiss = newExercise("Bench press");
if (oneMiss.rule?.kind === "linear") oneMiss.rule.deloadAfter = 1;
assert.equal(ruleSentence(oneMiss, "kg", 2.5), "Bench press goes up 2.5 kg after a session with every rep, and drops 10% after a miss.");
const tiny = newExercise("Curl");
if (tiny.rule?.kind === "linear") tiny.rule.incKg = 0.5;
assert.equal(ruleSentence(tiny, "kg", 2.5), "Curl adds 0.5 kg, less than your smallest jump, so its weight stays the same.");
const range = bench("range");
range.sets = range.sets.concat([structuredClone(range.sets[0])]).map((s) => ({ ...s, reps: { min: 3, max: 5 } }) as typeof s);
assert.equal(ruleSentence(range, "kg", 2.5), "Bench press goes up 2.5 kg once all 4 sets reach 5 reps, then the reps go back to 3.");
assert.equal(ruleSentence({ ...range, sets: range.sets.slice(0, 1) }, "kg", 2.5), "Bench press goes up 2.5 kg once your set reaches 5 reps, then the reps go back to 3.");
const mixed = structuredClone(range);
mixed.sets[0] = { kind: "fixed", reps: { min: 6, max: 10 }, rest: 120 };
assert.equal(ruleSentence(mixed, "kg", 2.5), "Bench press goes up 2.5 kg once every set reaches the top of its range, then the reps go back to the bottom.");
if (range.rule?.kind === "range") range.rule.incKg = 5;
assert.equal(ruleSentence(range, "kg", 2.5), "Bench press goes up 5 kg once all 4 sets reach 5 reps, then the reps go back to 3.");
const pct = bench("percent");
assert.equal(ruleSentence(pct, "kg", 2.5), "Bench press is 75% of your bench press max. It moves when you change the max.");
pct.sets[2] = { kind: "pct", pct: 0.85, reps: 3, rest: 120 };
assert.equal(ruleSentence(pct, "kg", 2.5), "Bench press is 75% to 85% of your bench press max. It moves when you change the max.");
assert.equal(ruleSentence(bench("rpe"), "kg", 2.5), "Bench press is worked out for RPE 8 from your best logged set.");
assert.equal(ruleSentence(bench("manual"), "kg", 2.5), "Bench press stays at the weight you choose.");

// A member program gives one line per distinct rule.
const mine = blankMemberTemplate();
mine.engine = { key: "own_rules" };
mine.weeks = [
  { days: [{ name: "A", exercises: [newExercise("Back squat"), bench("percent")] }] },
  { days: [{ name: "A", exercises: [newExercise("Back squat"), bench("manual")] }] },
];
assert.deepEqual(howWeightsMove(mine, "kg", 2.5), [
  "Back squat goes up 2.5 kg after a session with every rep, and drops 10% after three misses in a row.",
  "Bench press is 75% of your bench press max. It moves when you change the max.",
  "Bench press stays at the weight you choose.",
]);

console.log("programs/progressionText: ok");
