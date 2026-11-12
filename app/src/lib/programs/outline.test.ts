// app/src/lib/programs/outline.test.ts
// Run: npm test -- src/lib/programs/outline.test.ts
//
// Session length against hand-worked programs, the typical week and whole
// program outlines, the first week with real weights, training dates, the
// card tags and the line on why a weight is what it is.
import assert from "node:assert/strict";

import { initState } from "./engines";
import { daySeconds, firstSets, hasSessionTime, repeatNote, weightsMoveBetweenSessions, firstWeek, focusTag, lengthTag, sessionMinutes, shortDate, trainingDates, typicalWeek, weightWhy, wholeProgram } from "./outline";
import { planExercise } from "./planner";
import { applyRule, newExercise } from "./memberEditing";
import { blankMemberTemplate } from "./memberTemplate";
import { planSession, stateKey } from "./planner";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import { STEP_5LB_KG } from "./units";

const get = (key: string) => platformProgram(key)!;

// ── session length: sets x (40 s + rest), averaged over every day, to the nearest 5 minutes ──
// StrongLifts: A is 15 sets at 180 s rest (55 min), B is 11 sets (40.3 min). Three of each: 47.7, so 50.
assert.equal(daySeconds(get("stronglifts-5x5").weeks[0].days[0]), 15 * 220);
assert.equal(daySeconds(get("stronglifts-5x5").weeks[0].days[1]), 11 * 220);
assert.equal(sessionMinutes(get("stronglifts-5x5")), 50);
// Smolov base: weeks 1 to 3 are 26 sets at 180 s (5720 s a week), the test day is 5 sets with 990 s of rest. 13 days: 23.5, so 25.
assert.equal(sessionMinutes(get("smolov-base")), 25);
// GVT: every day is 20 sets at 90 s and 6 at 60 s, 3200 s: 53.3, so 55.
assert.equal(sessionMinutes(get("german-volume-training")), 55);
assert.equal(sessionMinutes({ weeks: [{ days: [{ name: "Short", exercises: [{ name: "Plank", sets: [{ kind: "fixed", reps: 1, rest: 0 }] }] }] }] }), 5, "never under 5 minutes");
assert.equal(sessionMinutes({ weeks: [] }), 5);
for (const t of PLATFORM_PROGRAMS) {
  const m = sessionMinutes(t);
  assert.ok(m >= 5 && m <= 180 && m % 5 === 0, `${t.key}: ${m} min`);
}

// ── outlines ──
const smolov = wholeProgram(get("smolov-base"));
assert.equal(smolov.length, 4);
assert.equal(smolov[1].title, "Week 2: Base, plus 10 kg");
assert.deepEqual(smolov[1].days[0], { name: "Day 1", test: false, lines: [{ name: "Back squat", rx: "4 x 9 at 70% + 10 kg", joined: false, notes: null }] });
assert.equal(smolov[3].days[0].test, true);
assert.equal(wholeProgram(get("smolov-base"), "lb")[1].days[0].lines[0].rx, "4 x 9 at 70% + about 20 lb", "a member in pounds sees the add-on in pounds");
assert.equal(wholeProgram(get("smolov-base"), "kg")[1].days[0].lines[0].rx, "4 x 9 at 70% + 10 kg");
assert.equal(wholeProgram(get("gzclp"))[0].title, "Week 1");
const tw = typicalWeek(get("smolov-base"));
assert.deepEqual(tw.map((d) => d.lines[0].rx), ["4 x 9 at 70%", "5 x 7 at 75%", "7 x 5 at 80%", "10 x 3 at 85%"]);
assert.deepEqual(typicalWeek(get("smolov-base"), "lb").map((d) => d.lines[0].rx), tw.map((d) => d.lines[0].rx), "week 1 has no add-on, so pounds read the same");
assert.equal(typicalWeek(get("gzclp"))[0].lines[0].rx, "4 x 3, then 1 x 3+", "GZCLP shows the first rep scheme");
const gvt = typicalWeek(get("german-volume-training"))[0];
assert.equal(gvt.lines[1].joined, true, "a superset is marked");
assert.ok(gvt.lines[0].notes?.startsWith("Lower for four seconds"));

// ── card tags ──
assert.equal(focusTag(get("smolov-base")), "Squat");
assert.equal(focusTag(get("smolov-jr-bench")), "Bench press");
assert.equal(focusTag(get("stronglifts-5x5")), "5 lifts");
assert.equal(focusTag(get("phul")), "Rep ranges");
assert.equal(lengthTag(get("smolov-base"), false), "4 weeks");
assert.equal(lengthTag(get("531-bbb"), true), "Repeats every 4 weeks");
assert.equal(lengthTag(get("phul"), true), "Repeats weekly");

// ── the first week with real weights ──
const fw = firstWeek(get("smolov-base"), { squat: 140 }, 2.5, "kg");
assert.deepEqual(fw.map((d) => d.lines[0]), ["Back squat 4 x 9 at 97.5 kg", "Back squat 5 x 7 at 105 kg", "Back squat 7 x 5 at 112.5 kg", "Back squat 10 x 3 at 120 kg"]);
assert.deepEqual(firstWeek(get("stronglifts-5x5"), { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, 2.5, "kg")[0].lines, [
  "Back squat 5 x 5 at 50 kg",
  "Bench press 5 x 5 at 40 kg",
  "Barbell row 5 x 5 at 35 kg",
]);
assert.equal(firstWeek(get("phul"), {}, 2.5, "kg")[0].lines[0], "Bench press 4 x 3-5, you pick the weight");
assert.equal(firstWeek(get("greyskull-lp"), { bench: 80, row: 70, squat: 100, press: 50, deadlift: 120 }, 2.5, "kg")[1].lines[1], "Chin-up 2 x 5, then 1 x 5+, bodyweight");
assert.equal(firstSets(get("smolov-base"), "squat", 140, 2.5, "kg"), "4 x 9 at 97.5 kg");
assert.equal(firstSets(get("smolov-base"), "squat", 140, STEP_5LB_KG, "lb"), "4 x 9 at 215 lb");
assert.equal(firstSets(get("531-bbb"), "squat", 100, 2.5, "kg"), "1 x 5 at 57.5 kg, then 1 x 5 at 67.5 kg, then 1 x 5+ at 77.5 kg", "5/3/1 uses the training max");
assert.equal(firstSets(get("smolov-base"), "bench", 100, 2.5, "kg"), null, "no exercise uses that lift");
{
  // The first week plans what the app will: with the member's last weight (planContextFor's lastKg) a manual exercise shows it, the same as planSession.
  const own = blankMemberTemplate();
  own.engine = { key: "own_rules" };
  const curl = applyRule(newExercise("Curl"), "manual");
  own.weeks = [{ days: [{ name: "A", exercises: [curl] }] }];
  const extra = { lastKg: { [stateKey(curl)]: 40 }, e1rm: {} };
  assert.equal(firstWeek(own, {}, 2.5, "kg")[0].lines[0], "Curl 3 x 5, you pick the weight");
  assert.equal(firstWeek(own, {}, 2.5, "kg", extra)[0].lines[0], "Curl 3 x 5 at 40 kg");
  assert.equal(planSession(own, initState(own, {}, 2.5), { stepKg: 2.5, ...extra })!.exercises[0].sets[0].kg, 40);
  // An RPE exercise with no max of its own plans from the best logged max (e1rm).
  const rpe = applyRule(newExercise("Leg press"), "rpe");
  own.weeks = [{ days: [{ name: "A", exercises: [rpe] }] }];
  assert.match(firstWeek(own, {}, 2.5, "kg", { e1rm: { [stateKey(rpe)]: 200 } })[0].lines[0], /^Leg press 3 x 5 at RPE 8, about \d+(\.\d+)? kg$/);
}
for (const t of PLATFORM_PROGRAMS) {
  const maxes = Object.fromEntries(t.lifts.map((l) => [l, 100]));
  for (const d of firstWeek(t, maxes, 2.5, "kg")) for (const l of d.lines) assert.ok(!/undefined|NaN|null/.test(l), `${t.key}: ${l}`);
}

// ── training dates ──
assert.deepEqual(trainingDates("2026-11-16", [1, 3, 5, 6], 4), ["2026-11-16", "2026-11-18", "2026-11-20", "2026-11-21"]);
assert.deepEqual(trainingDates("2026-11-18", [1, 3, 5, 6], 4), ["2026-11-18", "2026-11-20", "2026-11-21", "2026-11-23"]);
assert.deepEqual(trainingDates("2026-11-16", [], 3), []);
assert.equal(shortDate("2026-11-16"), "Mon 16 Nov");

// ── why a planned weight is what it is ──
const sm = get("smolov-base");
const st = initState(sm, { squat: 140 }, 2.5);
const wk2 = planExercise(sm.weeks[1].days[0].exercises[0], 0, { ...st, week: 1, day: 0 }, { stepKg: 2.5 });
assert.equal(weightWhy(wk2, sm.weeks[1].days[0].exercises[0], sm.tmPct, "kg"), "70% of your max, plus 10 kg this week.");
const bbb = get("531-bbb");
const bst = initState(bbb, { press: 60, deadlift: 160, bench: 100, squat: 140 }, 2.5);
const main = planExercise(bbb.weeks[0].days[0].exercises[0], 0, bst, { stepKg: 2.5 });
assert.equal(weightWhy(main, bbb.weeks[0].days[0].exercises[0], bbb.tmPct, "kg"), "65% to 85% of your training max.");
const sl = get("stronglifts-5x5");
const slPlan = planExercise(sl.weeks[0].days[0].exercises[0], 0, initState(sl, { squat: 100 }, 2.5), { stepKg: 2.5 });
assert.equal(weightWhy(slPlan, sl.weeks[0].days[0].exercises[0], sl.tmPct, "kg"), null, "a working weight needs no line");
const chin = planExercise(bbb.weeks[0].days[0].exercises[2], 2, bst, { stepKg: 2.5 });
assert.equal(weightWhy(chin, bbb.weeks[0].days[0].exercises[2], bbb.tmPct, "kg"), "Bodyweight.");

// ── weights between sessions, repeat note, session time, lb add-on ──
assert.equal(weightsMoveBetweenSessions(get("stronglifts-5x5")), true);
assert.equal(weightsMoveBetweenSessions(get("gzclp")), true);
assert.equal(weightsMoveBetweenSessions(get("smolov-base")), false);
assert.equal(weightsMoveBetweenSessions(get("531-bbb")), false);
assert.equal(weightsMoveBetweenSessions({ engine: { key: "own_rules" }, weeks: [{ days: [{ name: "A", exercises: [{ name: "Plank", rule: { kind: "manual" }, sets: [] }] }] }] } as never), false);
assert.equal(weightsMoveBetweenSessions({ engine: { key: "own_rules" }, weeks: [{ days: [{ name: "A", exercises: [{ name: "Plank", rule: { kind: "range" }, sets: [] }] }] }] } as never), true);
assert.equal(repeatNote({ weeks: [{ days: [] }, { days: [] }], lengthWeeks: 12 }, false), "These 2 weeks repeat for 12 weeks.");
assert.equal(repeatNote({ weeks: [{ days: [] }], lengthWeeks: 8 }, false), "This week repeats for 8 weeks.");
assert.equal(repeatNote({ weeks: [{ days: [] }], lengthWeeks: 8 }, true), null);
assert.equal(repeatNote({ weeks: [{ days: [] }, { days: [] }], lengthWeeks: 2 }, false), null);
assert.equal(hasSessionTime({ weeks: [{ days: [] }] }), false);
assert.equal(hasSessionTime(get("gzclp")), true);
const smEx = get("smolov-base").weeks[1].days[0].exercises[0];
const smPlan = planExercise(smEx, 0, initState(get("smolov-base"), { squat: 100 }, 2.5), { stepKg: 2.5 });
assert.ok(weightWhy(smPlan, smEx, 1, "lb")?.includes("plus about 20 lb this week"), "lb add-on rounds like the program page");
assert.ok(weightWhy(smPlan, smEx, 1, "kg")?.includes("plus 10 kg this week"));

console.log("programs/outline: ok");
