// Run: npm test -- src/lib/programs/convert.test.ts
//
// Every platform program converts to own rules, passes the member check, and
// plans week 1 with a weight wherever the original planned one: percentages
// from the carried training maxes, linear and range weights from the carried
// working weights. Plus each engine family's nearest rule.
import assert from "node:assert/strict";

import { toOwnRules } from "./convert";
import { initState } from "./engines";
import { memberKey, validateMemberTemplate } from "./memberTemplate";
import { planSession } from "./planner";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import type { LiftKey, ProgramTemplate, RuleKind } from "./types";

const STEP = 2.5;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

for (const original of PLATFORM_PROGRAMS) {
  const maxes = Object.fromEntries(original.lifts.map((l, i) => [l, 100 + i * 20])) as Partial<Record<LiftKey, number>>;
  const s = initState(original, maxes, STEP);
  const conv = toOwnRules(original, { weights: s.weights, tms: s.tms });
  const checked = validateMemberTemplate(conv.template, memberKey(1));
  assert.ok(checked.ok, `${original.key} passes the member check: ${checked.ok ? "" : checked.errors.join(" | ")}`);
  const t = checked.template;
  assert.equal(t.name, `My ${original.name}`);
  for (const lift of t.lifts) assert.ok(conv.maxes[lift] !== undefined, `${original.key}: a max for ${lift}`);
  const s2 = initState(t, conv.maxes, STEP);
  original.weeks[0].days.forEach((_, di) => {
    const a = planSession(original, { ...s, week: 0, day: di }, { stepKg: STEP })!;
    const b = planSession(t, { ...s2, week: 0, day: di }, { stepKg: STEP })!;
    assert.equal(b.exercises.length, a.exercises.length, `${original.key} day ${di + 1}: same exercises`);
    a.exercises.forEach((ea, xi) => {
      const eb = b.exercises[xi];
      assert.equal(eb.name, ea.name);
      ea.sets.forEach((sa, si) => {
        if (sa.kg === null) return;
        const kb = eb.sets[si]?.kg;
        assert.ok(kb !== null && kb !== undefined && near(kb, sa.kg), `${original.key} day ${di + 1} ${ea.name} set ${si + 1}: ${sa.kg} became ${kb}`);
      });
    });
  });
}

// ── the nearest rule for each engine family ──
const rules = (key: string): RuleKind[] => {
  const t = toOwnRules(platformProgram(key)!).template;
  return [...new Set(t.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises.map((e) => e.rule!.kind))))].sort();
};
assert.deepEqual(rules("stronglifts-5x5"), ["linear"], "linear engine");
assert.deepEqual(rules("phul"), ["range"], "double progression");
assert.deepEqual(rules("smolov-base"), ["percent"], "fixed block");
assert.deepEqual(rules("531-bbb"), ["manual", "percent"], "training-max cycle: percentages, and the accessories by hand");
assert.deepEqual(rules("gzclp"), ["linear", "manual"], "GZCLP: T1 and T2 add weight, T3 by hand");
assert.deepEqual(rules("german-volume-training"), ["linear", "manual"], "fixed volume");
assert.deepEqual(rules("phat"), ["manual", "range"], "PHAT keeps its fixed accessories by hand");

// ── percentages become percentages of the max; RPE sets on a percent exercise plan the same share ──
const bbb = toOwnRules(platformProgram("531-bbb")!).template;
const firstPct = bbb.weeks[0].days[0].exercises[0].sets[0];
assert.ok(firstPct.kind === "pct" && near(firstPct.pct, 0.65 * 0.9), "5/3/1's 65% of a 90% training max is 58.5% of the max");
const smolovTest = toOwnRules(platformProgram("smolov-base")!).template.weeks.at(-1)!.days.find((d) => d.test)!;
const lastSet = smolovTest.exercises[0].sets.at(-1)!;
assert.ok(lastSet.kind === "pct" && near(lastSet.pct, 1), "the max attempt is 100% of the max");
assert.equal(smolovTest.test, true, "a test day stays a test day");

// ── RPE-only exercises become rpe; mixed ones become manual ──
const mix: ProgramTemplate = {
  ...platformProgram("phul")!,
  weeks: [
    {
      days: [
        {
          name: "Day",
          exercises: [
            { name: "Bench press", lift: "bench", sets: [{ kind: "rpe", rpe: 8, reps: 3, rest: 180 }] },
            { name: "Barbell row", lift: "row", sets: [{ kind: "pct", pct: 0.7, reps: 5, rest: 120 }, { kind: "fixed", reps: 8, rest: 90 }] },
          ],
        },
      ],
    },
  ],
};
const mixed = toOwnRules(mix).template.weeks[0].days[0].exercises;
assert.equal(mixed[0].rule!.kind, "rpe");
assert.equal(mixed[0].lift, undefined, "an rpe exercise takes its weight from the member's logs");
assert.equal(mixed[1].rule!.kind, "manual");
assert.ok(mixed[1].sets.every((x) => x.kind === "fixed"));

// ── the member's current program: its weights and maxes come along ──
const sl = platformProgram("stronglifts-5x5")!;
const live = initState(sl, { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, STEP);
live.weights["back squat"] = 87.5;
const fromCurrent = toOwnRules(sl, { weights: live.weights, tms: live.tms }).template;
const sq = fromCurrent.weeks[0].days[0].exercises[0];
assert.deepEqual(sq.rule, { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 87.5 });
const dl = fromCurrent.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises)).find((e) => e.name === "Deadlift")!;
assert.equal(dl.rule?.kind === "linear" ? dl.rule.incKg : null, 5, "deadlift goes up 5 kg");

const w531 = platformProgram("531-fsl")!;
const s531 = initState(w531, { squat: 150, bench: 100, deadlift: 180, press: 60 }, STEP);
s531.tms.squat = 145;
const c531 = toOwnRules(w531, { weights: s531.weights, tms: s531.tms });
assert.ok(near(c531.maxes.squat!, 145 / 0.9), "the max that keeps the same weights: training max / 90%");

// ── a member program converts to itself, with its weights as start weights ──
const again = toOwnRules({ ...fromCurrent, key: "member:3" }, { weights: { "linear:back squat": 92.5 } }).template;
assert.equal(again.name, fromCurrent.name);
const sq2 = again.weeks[0].days[0].exercises[0];
assert.deepEqual(sq2.rule, { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 92.5 });

console.log("programs/convert: ok");
