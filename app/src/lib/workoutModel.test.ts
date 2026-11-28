// Run: npm test -- src/lib/workoutModel.test.ts
import assert from "node:assert/strict";

import {
  PROGRAM_LIMITS,
  blankDay,
  blankExercise,
  checkProgramLimits,
  cleanLoad,
  copyWeek,
  dayLabel,
  daysInWeek,
  lengthLabel,
  normaliseWeeks,
  programShape,
  shapeLabel,
  weekCount,
  type WorkoutDayInput,
} from "./workoutModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const day = (week: number, name: string, exercises = 0): WorkoutDayInput => ({
  week,
  name,
  instructions: null,
  exercises: Array.from({ length: exercises }, (_, i) => ({ ...blankExercise("workout"), name: `Ex ${i + 1}` })),
});

// ── limits ──
check("limits verbatim", !("maxWeeks" in PROGRAM_LIMITS) && PROGRAM_LIMITS.maxDaysPerWeek === 7 && PROGRAM_LIMITS.maxDays === 1000 && PROGRAM_LIMITS.maxExercisesPerDay === 200);

// ── labels: one week, exactly as before ──
const oneWeek = [day(1, "Push"), day(1, ""), day(1, "Legs")];
check("one week: own name", dayLabel(oneWeek, 0) === "Push");
check("one week: fallback counts within the program", dayLabel(oneWeek, 1) === "Day 2");
check("one week: no week prefix", dayLabel(oneWeek, 2) === "Legs");

// ── labels: several weeks ──
const twoWeeks = [day(1, "Push"), day(1, ""), day(2, ""), day(2, "Day 2 – Pull")];
check("several weeks: prefix + own name", dayLabel(twoWeeks, 0) === "Week 1 · Push");
check("several weeks: fallback within its week", dayLabel(twoWeeks, 1) === "Week 1 · Day 2");
check("several weeks: fallback restarts each week", dayLabel(twoWeeks, 2) === "Week 2 · Day 1");
check("several weeks: middle dot separator", dayLabel(twoWeeks, 3) === "Week 2 · Day 2 – Pull");

// ── normaliseWeeks ──
const messy = [
  { ...day(3, "C1") },
  { ...day(1, "A1") },
  { ...(day(1, "B0") as WorkoutDayInput), week: undefined as unknown as number },
  { ...day(3, "C2") },
  { ...day(0, "Bad") },
  { ...day(1.5, "Frac") },
];
const norm = normaliseWeeks(messy);
check("missing/invalid week -> 1, stable inside a week", norm.map((d) => d.name).join() === "A1,B0,Bad,Frac,C1,C2");
check("gaps renumbered 1..K", norm.map((d) => d.week).join() === "1,1,1,1,2,2");
check("input untouched", messy[0].week === 3);
check("already normal stays the same", normaliseWeeks(twoWeeks).map((d) => `${d.week}${d.name}`).join() === twoWeeks.map((d) => `${d.week}${d.name}`).join());
check("weeks 2 and 5 become 1 and 2", normaliseWeeks([day(5, "b"), day(2, "a")]).map((d) => `${d.week}${d.name}`).join() === "1a,2b");

// ── counts + shape ──
check("weekCount", weekCount(twoWeeks) === 2 && weekCount(oneWeek) === 1 && weekCount([]) === 0);
check("daysInWeek", daysInWeek(twoWeeks, 2).length === 2 && daysInWeek(twoWeeks, 3).length === 0);
const even = [day(1, "a"), day(1, "b"), day(2, "a"), day(2, "b"), day(3, "a"), day(3, "b")];
assert.deepEqual(programShape(even), { weeks: 3, daysPerWeek: 2, totalDays: 6 });
passed++;
const uneven = [day(1, "a"), day(1, "b"), day(2, "a")];
assert.deepEqual(programShape(uneven), { weeks: 2, daysPerWeek: null, totalDays: 3 });
passed++;
check("shape: one week", shapeLabel(oneWeek) === "3 days" && shapeLabel([day(1, "x")]) === "1 day");
check("shape: even weeks", shapeLabel(even) === "3 weeks, 2 days a week");
check("shape: uneven weeks", shapeLabel(uneven) === "2 weeks, 3 days");
check("shape: one day a week", shapeLabel([day(1, "a"), day(2, "a")]) === "2 weeks, 1 day a week");

// ── limits errors ──
check("a normal program passes", checkProgramLimits(even) === null && checkProgramLimits([]) === null);
check("weeks are unlimited: 200 weeks is fine", checkProgramLimits(Array.from({ length: 200 }, (_, i) => day(i + 1, "x"))) === null);
check("too many days in a week", checkProgramLimits(Array.from({ length: 8 }, () => day(1, "x"))) === "Week 1 has 8 days. A week can have at most 7.");
check("too many days", checkProgramLimits(Array.from({ length: 1001 }, (_, i) => day(Math.floor(i / 7) + 1, "x")))?.includes("at most 1000 days") === true);
check("too many exercises", checkProgramLimits([day(1, "Push", 201)]) === "Push has 201 exercises. A day can have at most 200.");
check("200 exercises is fine", checkProgramLimits([day(1, "Push", 200)]) === null);

// ── copyWeek ──
const src: WorkoutDayInput[] = [
  { id: 10, week: 1, name: "Push", instructions: "Warm up well", exercises: [{ ...blankExercise("workout"), id: 100, name: "Bench", load: "70%", muscleGroups: ["Chest"] }] },
  { id: 11, week: 1, name: "Pull", instructions: null, exercises: [] },
  { id: 12, week: 2, name: "Legs", instructions: null, exercises: [] },
];
const copied = copyWeek(src, 1);
check("copy appended as a new last week", copied.length === 5 && copied[3].week === 3 && copied[4].week === 3);
check("copy keeps names and order", copied[3].name === "Push" && copied[4].name === "Pull");
check("copy strips day ids", copied[3].id === undefined && copied[4].id === undefined && copied[0].id === 10);
check("copy strips exercise ids, keeps load", copied[3].exercises[0].id === undefined && copied[3].exercises[0].load === "70%");
copied[3].exercises[0].name = "Changed";
copied[3].exercises[0].muscleGroups.push("Triceps");
check("exercises deep copied", src[0].exercises[0].name === "Bench" && src[0].exercises[0].muscleGroups.join() === "Chest");
check("copy of a missing week changes nothing", copyWeek(src, 9).length === 3);

// ── list length text ──
check("length: one week", lengthLabel(1, 4) === "4 days" && lengthLabel(1, 1) === "1 day" && lengthLabel(0, 0) === "0 days");
check("length: several weeks", lengthLabel(8, 32) === "8 weeks, 32 days" && lengthLabel(2, 1) === "2 weeks, 1 day");

// ── load + blanks ──
check("load trimmed, empty -> null", cleanLoad("  70%  ") === "70%" && cleanLoad("   ") === null && cleanLoad(null) === null && cleanLoad(5) === null);
check("load capped at 60", cleanLoad("x".repeat(80))?.length === 60);
check("blank day is week 1", blankDay().week === 1 && blankDay("Day 2", 3).week === 3);

console.log(`workoutModel.test.ts: ${passed} checks passed`);
