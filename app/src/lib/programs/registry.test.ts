// app/src/lib/programs/registry.test.ts
// Run: npm test -- src/lib/programs/registry.test.ts
//
// The template check over every platform program, and an end-to-end run of
// each with two simulated members (perfect, and scripted misses), in kg and
// in pounds. Later tasks only add programs to the registry.
import assert from "node:assert/strict";

import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import { plannedSessionCount, runProblems, scriptedMisses, simulate } from "./simulate";
import { STEP_5LB_KG } from "./units";
import { validateTemplate } from "./validate";

const keys = new Set<string>();
for (const t of PLATFORM_PROGRAMS) {
  assert.ok(!keys.has(t.key), `${t.key}: duplicate key`);
  keys.add(t.key);
  assert.equal(platformProgram(t.key), t);
  const v = validateTemplate(t);
  assert.ok(v.ok, `${t.key}: ${v.ok ? "" : v.errors.join(" | ")}`);
  assert.ok(t.author.trim().length > 0, `${t.key}: needs an author credit`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(t)), `${t.key}: no emojis`);
  assert.ok(t.weeks.every((w) => w.days.length <= t.daysPerWeek), `${t.key}: a week has more days than daysPerWeek`);

  const maxes = Object.fromEntries(t.lifts.map((l) => [l, 140]));
  const ideal = simulate(t, { maxes });
  assert.deepEqual(runProblems(ideal), [], `${t.key}: perfect member`);
  assert.equal(ideal.sessions.length, plannedSessionCount(t), `${t.key}: runs its full length`);
  if (t.engine.key === "fixed_block") assert.equal(ideal.final.finished, true, `${t.key}: a block ends finished`);
  assert.deepEqual(runProblems(simulate(t, { maxes, performer: scriptedMisses(3) })), [], `${t.key}: scripted misses`);
  assert.deepEqual(runProblems(simulate(t, { maxes, stepKg: STEP_5LB_KG, unit: "lb" })), [], `${t.key}: pounds`);
}

assert.equal(platformProgram("no-such-program"), null);

// The check refuses what it should.
const sl = platformProgram("stronglifts-5x5")!;
const badName = structuredClone(sl);
badName.weeks[0].days[0].exercises[0].name = "Squat jumps on a bosu";
assert.equal(validateTemplate(badName).ok, false);
const badPct = structuredClone(sl);
badPct.weeks[0].days[0].exercises[0].sets[0] = { kind: "pct", pct: 1.2, reps: 1, rest: 180 };
const badPctCheck = validateTemplate(badPct);
assert.ok(!badPctCheck.ok && badPctCheck.errors.some((e) => e.includes("120% is outside 30% to 110%")));
const noMax = structuredClone(sl);
noMax.lifts = noMax.lifts.filter((l) => l !== "row");
const noMaxCheck = validateTemplate(noMax);
assert.ok(!noMaxCheck.ok && noMaxCheck.errors.some((e) => e.includes("uses the barbell row max, which this program does not ask for")));

console.log(`programs/registry: ${PLATFORM_PROGRAMS.length} programs ok`);
