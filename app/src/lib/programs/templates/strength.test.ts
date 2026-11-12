// app/src/lib/programs/templates/strength.test.ts
// Run: npm test -- src/lib/programs/templates/strength.test.ts
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { nsunsStyle } from "./nsuns";
import { line, planAt, simulate } from "../simulate";
import type { SetRx } from "../types";
import { validateTemplate } from "../validate";

// A max of 111.11 kg gives a 90% training max of exactly 100 kg.
const tm100 = { squat: 111.11, bench: 111.11, deadlift: 111.11, press: 111.11 };

// ── 5/3/1 Boring But Big ──────────────────────────────────────────────────
const bbb = platformProgram("531-bbb")!;
assert.deepEqual(bbb.weeks[0].days.map((d) => d.name), ["Press day", "Deadlift day", "Bench day", "Squat day"]);
assert.deepEqual(planAt(bbb, tm100, 0, 0).exercises.map((e) => line(e)), [
  "Overhead press 1 x 5 at 65 kg, then 1 x 5 at 75 kg, then 1 x 5+ at 85 kg",
  "Overhead press 5 x 10 at 50 kg",
  "Chin-up 5 x 10",
]);
assert.equal(line(planAt(bbb, tm100, 1, 3).exercises[0]), "Back squat 1 x 3 at 70 kg, then 1 x 3 at 80 kg, then 1 x 3+ at 90 kg");
assert.equal(line(planAt(bbb, tm100, 2, 2).exercises[0]), "Bench press 1 x 5 at 75 kg, then 1 x 3 at 85 kg, then 1 x 1+ at 95 kg");
const deload = planAt(bbb, tm100, 3, 1);
assert.deepEqual(deload.exercises.map((e) => line(e)), ["Deadlift 1 x 5 at 40 kg, then 1 x 5 at 50 kg, then 1 x 5 at 60 kg", "Hanging leg raise 5 x 15"]);
// three cycles, every rep: +2.5 kg upper, +5 kg lower per cycle
const bbbRun = simulate(bbb, { maxes: tm100 });
assert.equal(bbbRun.sessions.length, 48);
assert.deepEqual(bbbRun.final.tms, { squat: 115, bench: 107.5, deadlift: 115, press: 107.5 });

// ── 5/3/1 First Set Last ──────────────────────────────────────────────────
const fsl = platformProgram("531-fsl")!;
assert.equal(line(planAt(fsl, tm100, 1, 0).exercises[1]), "Overhead press 5 x 5 at 70 kg");
assert.equal(line(planAt(fsl, tm100, 2, 3).exercises[1]), "Back squat 5 x 5 at 75 kg");
assert.equal(planAt(fsl, tm100, 3, 0).exercises.length, 2, "no supplemental sets on the deload");

// ── nSuns-style 5-day ─────────────────────────────────────────────────────
// nSuns-style is not in the registry yet, so it is imported directly.
const ns = nsunsStyle;
assert.ok(validateTemplate(ns).ok, "nSuns-style passes the template check");
assert.equal(ns.weeks.length, 1);
assert.equal(ns.weeks[0].days.length, 5);
assert.deepEqual(planAt(ns, tm100, 0, 1).exercises.map((e) => line(e)), [
  "Back squat 1 x 5 at 75 kg, then 1 x 3 at 85 kg, then 1 x 1+ at 95 kg, then 1 x 3 at 90 kg, then 1 x 3 at 85 kg, then 1 x 3 at 80 kg, then 1 x 5 at 75 kg, then 1 x 5 at 70 kg, then 1 x 5+ at 65 kg",
  "Sumo deadlift 1 x 5 at 50 kg, then 1 x 5 at 60 kg, then 1 x 3 at 70 kg, then 1 x 5 at 70 kg, then 1 x 7 at 70 kg, then 1 x 4 at 70 kg, then 1 x 6 at 70 kg, then 1 x 8 at 70 kg",
]);
// one week, every rep (3 reps on each 1+ set): +2.5 kg on all four training maxes
assert.deepEqual(simulate(ns, { maxes: tm100, sessions: 5 }).final.tms, { squat: 102.5, bench: 102.5, deadlift: 102.5, press: 102.5 });

// ── Texas Method ─────────────────────────────────────────────────────────
// A max of 116.67 kg gives an estimated 5-rep max (6/7) of exactly 100 kg.
const tx = platformProgram("texas-method")!;
const tx100 = { squat: 116.67, bench: 116.67, press: 116.67, deadlift: 116.67 };
assert.deepEqual(planAt(tx, tx100, 0, 0).exercises.map((e) => line(e)), ["Back squat 5 x 5 at 90 kg", "Bench press 5 x 5 at 90 kg", "Deadlift 1 x 5 at 100 kg"]);
assert.deepEqual(planAt(tx, tx100, 0, 1).exercises.slice(0, 2).map((e) => line(e)), ["Back squat 2 x 5 at 72.5 kg", "Overhead press 3 x 5 at 80 kg"]);
assert.deepEqual(planAt(tx, tx100, 0, 2).exercises.slice(0, 2).map((e) => line(e)), ["Back squat 1 x 5 at 100 kg", "Bench press 1 x 5 at 100 kg"]);
assert.equal(line(planAt(tx, tx100, 1, 2).exercises[1]), "Overhead press 1 x 5 at 100 kg");
assert.deepEqual(simulate(tx, { maxes: tx100, sessions: 3 }).final.tms, { squat: 102.5, bench: 102.5, press: 100, deadlift: 105 });

// ── GZCLP ────────────────────────────────────────────────────────────────
const gz = platformProgram("gzclp")!;
const gz100 = { squat: 100, bench: 100, press: 100, deadlift: 100 };
assert.deepEqual(gz.weeks[0].days.map((d) => d.name), ["A1", "B1", "A2", "B2"]);
assert.deepEqual(planAt(gz, gz100, 0, 0).exercises.map((e) => line(e)), [
  "Back squat 4 x 3 at 72.5 kg, then 1 x 3+ at 72.5 kg",
  "Bench press 3 x 10 at 55 kg",
  "Lat pulldown 2 x 15, then 1 x 15+",
]);
assert.deepEqual(planAt(gz, gz100, 0, 1).exercises.map((e) => line(e)), [
  "Overhead press 4 x 3 at 72.5 kg, then 1 x 3+ at 72.5 kg",
  "Deadlift 3 x 10 at 55 kg",
  "Dumbbell row 2 x 15, then 1 x 15+",
]);
const gzOne = simulate(gz, { maxes: gz100, sessions: 4 }).final.weights;
assert.equal(gzOne["t1:back squat"], 77.5);
assert.equal(gzOne["t2:back squat"], 60);
assert.equal(gzOne["t1:deadlift"], 77.5);
assert.equal(gzOne["t1:bench press"], 75);

// GZCLP's later stages, read from the template itself (not through the engine).
/** "6x2+": the set count, the reps, and a + when only the last set is as many as you can. */
const scheme = (sets: SetRx[]) => {
  const reps = sets.map((x) => (typeof x.reps === "number" ? x.reps : x.reps.min));
  assert.ok(reps.every((r) => r === reps[0]), "one rep count per stage");
  const plus = sets.map((x) => x.kind === "fixed" && x.amrap === true);
  assert.ok(plus.slice(0, -1).every((p) => !p), "only the last set can be a + set");
  return `${sets.length}x${reps[0]}${plus[plus.length - 1] ? "+" : ""}`;
};
const gzAll = gz.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises));
const gzT1 = gzAll.filter((e) => e.tier === "t1");
const gzT2 = gzAll.filter((e) => e.tier === "t2");
assert.equal(gzT1.length, 4);
assert.equal(gzT2.length, 4);
for (const e of gzT1) assert.deepEqual(e.stages!.map(scheme), ["5x3+", "6x2+", "10x1+"], e.name);
for (const e of gzT2) assert.deepEqual(e.stages!.map(scheme), ["3x10", "3x8", "3x6"], e.name);
for (const e of [...gzT1, ...gzT2]) assert.deepEqual(e.sets, e.stages![0], `${e.name} starts on its first stage`);
assert.ok(gz.engine.key === "tm_cycle" && gz.engine.t3AmrapTarget === 25, "T3 goes up once the last set reaches 25");
for (const e of gzAll.filter((x) => x.tier === "t3")) assert.equal(scheme(e.sets), "3x15+", e.name);

// Copy that the reviews pinned.
assert.equal(tx.author, "Texas Method, from Glenn Pendlay, as written up by Mark Rippetoe");
assert.equal(tx.warning, "A new 5-rep max every week. Expect to stall and change the plan within a few months.");
assert.equal(gz.level, "beginner");
assert.ok(gz.who.startsWith("Beginners"), "GZCLP's who line agrees with its level");
for (const t of [bbb, fsl]) {
  assert.ok(t.description.includes("If you miss the minimum reps on a lift's + set"), `${t.key} says what a missed + set does`);
  assert.ok(t.description.includes("This hold is our rule."), `${t.key} says the hold is our rule`);
}

console.log("programs/templates/strength: ok");
