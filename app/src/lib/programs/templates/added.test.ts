// app/src/lib/programs/templates/added.test.ts
// Run: npm test -- src/lib/programs/templates/added.test.ts
//
// The nine programs added on 2026-11-14: their sessions, the Juggernaut
// training-max rule in kg and pounds, and what "how your weights move" says.
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { howWeightsMove } from "../progressionText";
import { line, perfect, planAt, simulate, type Performer } from "../simulate";
import { STEP_5LB_KG } from "../units";

// A max of 111.11 kg gives a 90% training max of exactly 100 kg.
const tm100 = { squat: 111.11, bench: 111.11, deadlift: 111.11, press: 111.11 };
const days = (key: string) => platformProgram(key)!.weeks.map((w) => w.days.map((d) => d.name));

// ── Juggernaut-style ──────────────────────────────────────────────────────
const jug = platformProgram("juggernaut-style")!;
assert.equal(jug.weeks.length, 16);
assert.deepEqual(jug.weeks.map((w) => w.label).slice(0, 4), ["10s wave: accumulation", "10s wave: intensification", "10s wave: realization", "10s wave: deload"]);
assert.equal(line(planAt(jug, tm100, 0, 1).exercises[0]), "Bench press 5 x 10 at 60 kg");
assert.equal(line(planAt(jug, tm100, 2, 0).exercises[0]), "Back squat 1 x 5 at 50 kg, then 1 x 3 at 60 kg, then 1 x 1 at 70 kg, then 1 x 10+ at 75 kg");
assert.equal(line(planAt(jug, tm100, 14, 3).exercises[0]), "Overhead press 1 x 5 at 50 kg, then 1 x 3 at 60 kg, then 1 x 1 at 70 kg, then 1 x 3+ at 90 kg");
{
  // The perfect member beats each + set by two: +2.5 kg upper, +5 kg lower, per wave.
  const run = simulate(jug, { maxes: tm100 });
  assert.equal(run.sessions.length, 64);
  assert.deepEqual(run.final.tms, { squat: 120, bench: 110, deadlift: 120, press: 110 });
  assert.ok(run.reasons.flat().includes("Squat training max goes up to 105 kg. You got 12 on the 10+ set, 2 over."));
  // The 8s wave plans from the raised training max.
  assert.equal(line(planAt(jug, tm100, 4, 0).exercises[0]), "Back squat 5 x 8 at 65 kg", "planAt starts fresh");
  assert.equal(run.sessions[16].exercises[0].sets[0].kg, 67.5, "squat 8s at 65% of a 105 kg training max, to the nearest 2.5 kg");
}
{
  // Only five extra reps count, however many are logged.
  const big: Performer = (c) => (c.set.amrap ? { ...perfect(c), reps: c.set.reps + 20 } : perfect(c));
  const run = simulate(jug, { maxes: tm100, sessions: 12, performer: big });
  assert.equal(run.final.tms.squat, 112.5);
  assert.equal(run.final.tms.bench, 106.25);
}
{
  // A + set that falls short holds the training max.
  const short: Performer = (c) => (c.set.amrap ? { ...perfect(c), reps: c.set.reps - 1 } : perfect(c));
  const run = simulate(jug, { maxes: tm100, sessions: 12, performer: short });
  assert.equal(run.final.tms.squat, 100);
  assert.ok(run.reasons.flat().includes("Squat training max stays at 100 kg. You got 9 on the 10+ set."));
}
{
  // In pounds a rep past the target is 2.5 lb upper, 5 lb lower.
  const run = simulate(jug, { maxes: tm100, sessions: 12, stepKg: STEP_5LB_KG, unit: "lb" });
  assert.equal(run.final.tms.squat, Math.round((100 + 2 * 2.268) * 100) / 100);
  assert.equal(run.final.tms.bench, Math.round((100 + 2 * 1.134) * 100) / 100);
}
assert.deepEqual(howWeightsMove(jug, "kg", 2.5).slice(0, 4), [
  "Your training max is 90% of your max. Every percentage is taken from it.",
  "The last set of each main lift in weeks 3, 7, 11 and 15 is as many reps as you can.",
  "Each rep past the target on that set raises that lift's training max by 1.25 kg, or 2.5 kg on the squat and deadlift. Up to five extra reps count, and the weeks after it use the new training max.",
  "If the + set falls short of the target, isn't ticked, or is more than one jump lighter than planned, the training max stays the same.",
]);
assert.ok(howWeightsMove(jug, "lb", STEP_5LB_KG).includes("Each rep past the target on that set raises that lift's training max by 2.5 lb, or 5 lb on the squat and deadlift. Up to five extra reps count, and the weeks after it use the new training max."));

// ── RTS-style RPE block ───────────────────────────────────────────────────
const rts = platformProgram("rts-style-rpe-block")!;
const max140 = { squat: 140, bench: 140, deadlift: 140 };
assert.deepEqual(days("rts-style-rpe-block")[0], ["Squat and bench", "Deadlift and bench", "Squat variation and bench"]);
assert.equal(line(planAt(rts, max140, 0, 0).exercises[0]), "Back squat 1 x 8 at RPE 7, about 102.5 kg, then 3 x 8 at RPE 6.5, about 100 kg");
assert.equal(line(planAt(rts, max140, 5, 1).exercises[0]), "Deadlift 1 x 5 at RPE 9, about 117.5 kg, then 2 x 5 at RPE 8, about 112.5 kg");
assert.equal(rts.weeks[8].days.every((d) => d.test), true, "week 9 is the test");
assert.equal(
  howWeightsMove(rts, "kg", 2.5)[0],
  "Each set has a target effort (RPE). The app suggests a weight from the max you enter. Go by the effort: if the set feels harder or easier than its RPE, change the weight.",
);

// ── Calgary Barbell-style 16-week ─────────────────────────────────────────
const cal = platformProgram("calgary-barbell-style-16-week")!;
assert.equal(cal.weeks.length, 16);
assert.equal(line(planAt(cal, max140, 0, 0).exercises[0]), "Back squat 4 x 8 at 90 kg");
assert.equal(line(planAt(cal, max140, 0, 2).exercises[0]), "Pause squat 3 x 8 at 80 kg");
assert.equal(line(planAt(cal, max140, 12, 0).exercises[0]), "Back squat 1 x 1 at 125 kg, then 3 x 2 at 120 kg");
assert.equal(howWeightsMove(cal, "kg", 2.5)[0], "Every weight is a percentage of the max you enter.");

// ── Westside-style conjugate ──────────────────────────────────────────────
const conj = platformProgram("westside-style-conjugate")!;
assert.deepEqual(conj.weeks.map((w) => w.days[0].exercises[0].name), ["Box squat", "Rack pull", "Good morning", "Front squat", "Deficit deadlift", "Pause squat", "Sumo deadlift", "Box squat", "Rack pull"]);
assert.equal(line(planAt(conj, max140, 0, 2).exercises[0]), "Box squat 10 x 2 at 70 kg");
assert.equal(line(planAt(conj, max140, 2, 2).exercises[1]), "Deadlift 6 x 1 at 97.5 kg");
assert.equal(line(planAt(conj, max140, 1, 3).exercises[0]), "Bench press 9 x 3 at 77.5 kg");
assert.equal(planAt(conj, max140, 0, 0).exercises[0].sets[0].kg, null, "a max-effort lift waits for the member's own log");
assert.ok(howWeightsMove(conj, "kg", 2.5).includes("Sets with an RPE are a target effort. Once you have logged that exercise, the app suggests a weight from your best recent set."));
assert.ok(howWeightsMove(conj, "kg", 2.5).includes("The box squat, deadlift and bench press sets with a percentage are taken from the max you enter, and stay the same until you change it."));

// ── RP-style hypertrophy block ────────────────────────────────────────────
const rp = platformProgram("rp-style-hypertrophy-block")!;
assert.deepEqual(rp.weeks.map((w) => w.days[0].exercises[0].sets.length), [3, 3, 4, 4, 5, 2], "sets rise, then the deload halves them");
assert.ok(rp.weeks[5].days.every((d) => d.exercises.every((e) => e.progress === false)), "the deload never moves a weight");
{
  // The deload plans the weight the build weeks reached.
  const run = simulate(rp, { maxes: {} });
  const deloadBench = run.sessions.find((s) => s.week === 5 && s.day === 0)!.exercises[0];
  assert.equal(deloadBench.sets[0].kg, run.states[24].weights["bench press@8-12"]);
}

// ── Y3T-style, FST-7-style, DC-style, upper/lower ─────────────────────────
const y3t = platformProgram("y3t-style")!;
assert.deepEqual([0, 1, 2].map((w) => line(planAt(y3t, {}, w, 0).exercises[0])), [
  "Back squat 4 x 6-8",
  "Back squat 4 x 8-12",
  "Back squat 3 x 15-20",
]);
assert.equal(line(planAt(platformProgram("fst-7-style")!, {}, 0, 0).exercises[4]), "Leg extension 7 x 8-12");
assert.deepEqual(days("dc-style"), [
  ["Workout A1", "Workout B1", "Workout A2"],
  ["Workout B2", "Workout A1", "Workout B1"],
  ["Workout A2", "Workout B2", "Workout A1"],
  ["Workout B1", "Workout A2", "Workout B2"],
]);
assert.deepEqual(days("upper-lower-4-day"), [["Upper A", "Lower A", "Upper B", "Lower B"]]);

console.log("programs/templates added: ok");
