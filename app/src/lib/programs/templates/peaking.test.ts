// app/src/lib/programs/templates/peaking.test.ts
// Run: npm test -- src/lib/programs/templates/peaking.test.ts
import assert from "node:assert/strict";

import { sessionCount, summarisePlanned } from "../planner";
import { platformProgram } from "../registry";
import { line, perfect, planAt, simulate, type Performer } from "../simulate";

const firstLine = (key: string, maxes: Record<string, number>, w: number, d: number) => line(planAt(platformProgram(key)!, maxes, w, d).exercises[0]);

// ── Smolov base mesocycle: week 1 day 1 is 4 x 9 at 70% ─────────────────
const sq100 = { squat: 100 };
assert.equal(firstLine("smolov-base", sq100, 0, 0), "Back squat 4 x 9 at 70 kg");
assert.equal(firstLine("smolov-base", sq100, 0, 1), "Back squat 5 x 7 at 75 kg");
assert.equal(firstLine("smolov-base", sq100, 0, 2), "Back squat 7 x 5 at 80 kg");
assert.equal(firstLine("smolov-base", sq100, 0, 3), "Back squat 10 x 3 at 85 kg");
assert.equal(firstLine("smolov-base", sq100, 1, 0), "Back squat 4 x 9 at 80 kg");
assert.equal(firstLine("smolov-base", sq100, 2, 0), "Back squat 4 x 9 at 85 kg");
assert.equal(firstLine("smolov-base", sq100, 2, 3), "Back squat 10 x 3 at 100 kg");
const smolov = platformProgram("smolov-base")!;
assert.equal(sessionCount(smolov), 13);
assert.equal(smolov.weeks[3].days[0].test, true);
// the test day sets the new max; the block then finishes
const tested: Performer = (c) => (c.session.test && c.setIndex === 4 ? { kg: 110, reps: 1, done: true } : perfect(c));
const smolovRun = simulate(smolov, { maxes: sq100, performer: tested });
assert.equal(smolovRun.sessions.length, 13);
assert.equal(smolovRun.final.finished, true);
assert.equal(smolovRun.final.testMaxes.squat, 110);
assert.ok(smolovRun.reasons[12].includes("Your new squat max is about 110 kg, from 110 kg x 1."));
assert.deepEqual(smolovRun.reasons.slice(0, 12).flat(), [], "no changes inside the block");

// ── Smolov Jr ─────────────────────────────────────────────────────────────
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 0), "Back squat 6 x 6 at 70 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 1), "Back squat 7 x 5 at 75 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 2), "Back squat 8 x 4 at 80 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 3), "Back squat 10 x 3 at 85 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 1, 0), "Back squat 6 x 6 at 75 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 2, 0), "Back squat 6 x 6 at 80 kg");
assert.equal(firstLine("smolov-jr-bench", { bench: 100 }, 1, 0), "Bench press 6 x 6 at 72.5 kg");
assert.equal(firstLine("smolov-jr-bench", { bench: 100 }, 2, 0), "Bench press 6 x 6 at 75 kg");
assert.equal(sessionCount(platformProgram("smolov-jr-squat")!), 13);

// ── Russian Squat Routine: all 18 sessions ────────────────────────────────
const rsr = platformProgram("russian-squat-routine")!;
const rsrLines = rsr.weeks.flatMap((w, wi) => w.days.map((_d, di) => summarisePlanned(planAt(rsr, sq100, wi, di).exercises[0].sets, "kg")));
assert.deepEqual(rsrLines, [
  "6 x 2 at 80 kg", "6 x 3 at 80 kg", "6 x 2 at 80 kg",
  "6 x 4 at 80 kg", "6 x 2 at 80 kg", "6 x 5 at 80 kg",
  "6 x 2 at 80 kg", "6 x 6 at 80 kg", "6 x 2 at 80 kg",
  "5 x 5 at 85 kg", "6 x 2 at 80 kg", "4 x 4 at 90 kg",
  "6 x 2 at 80 kg", "3 x 3 at 95 kg", "6 x 2 at 80 kg",
  "2 x 2 at 100 kg", "6 x 2 at 80 kg",
  "1 x 5 at 50 kg, then 1 x 3 at 70 kg, then 1 x 1 at 85 kg, then 1 x 1 at 95 kg, then 1 x 1 at 105 kg",
]);
assert.equal(rsr.weeks[5].days[2].test, true);

// ── Candito-style 6-week ──────────────────────────────────────────────────
const all100 = { squat: 100, bench: 100, deadlift: 100 };
const candito = platformProgram("candito-style-6-week")!;
assert.deepEqual(planAt(candito, all100, 0, 0).exercises.map((e) => line(e)), ["Back squat 4 x 6 at 70 kg", "Deadlift 2 x 6 at 65 kg"]);
assert.equal(firstLine("candito-style-6-week", all100, 1, 0), "Back squat 4 x 6 at 72.5 kg");
assert.equal(firstLine("candito-style-6-week", all100, 4, 1), "Bench press 2 x 2 at 90 kg, then 1 x 1 at 95 kg");
assert.equal(sessionCount(candito), 22);
assert.equal(candito.name.endsWith("-style 6-week"), true);

// ── Sheiko-style ──────────────────────────────────────────────────────────
const sheiko = platformProgram("sheiko-style")!;
assert.equal(firstLine("sheiko-style", all100, 0, 0), "Back squat 1 x 5 at 50 kg, then 1 x 4 at 60 kg, then 2 x 3 at 70 kg, then 5 x 2 at 75 kg");
assert.equal(sessionCount(sheiko), 14);
assert.equal(sheiko.name, "Sheiko-style");

// every block ends in a test week
for (const key of ["smolov-base", "smolov-jr-squat", "smolov-jr-bench", "russian-squat-routine", "candito-style-6-week", "sheiko-style"]) {
  const t = platformProgram(key)!;
  assert.equal(t.engine.key, "fixed_block", key);
  assert.ok(t.weeks[t.weeks.length - 1].days.some((d) => d.test), `${key} ends in a test`);
  assert.ok(t.warning, `${key} carries a warning line`);
}

console.log("programs/templates/peaking: ok");
