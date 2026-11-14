// app/src/lib/programs/templates/calgary.ts
import { day, ex, fixed, maxTest, pct, range, sxr, times, week } from "../dsl";
import type { ProgramTemplate, SetRx, WeekRx } from "../types";

/** One week: the main sets, reps and percentage; variations are 7.5% lighter with one set fewer. */
interface Wk {
  label: string;
  sets: number;
  reps: number;
  pct: number;
  /** Peak weeks: a heavy single before the main sets. */
  single?: number;
}

const WEEKS: Wk[] = [
  { label: "Hypertrophy", sets: 4, reps: 8, pct: 0.65 },
  { label: "Hypertrophy", sets: 4, reps: 8, pct: 0.675 },
  { label: "Hypertrophy", sets: 5, reps: 7, pct: 0.7 },
  { label: "Hypertrophy, lighter", sets: 3, reps: 6, pct: 0.65 },
  { label: "Strength", sets: 5, reps: 5, pct: 0.75 },
  { label: "Strength", sets: 5, reps: 5, pct: 0.775 },
  { label: "Strength", sets: 4, reps: 4, pct: 0.8 },
  { label: "Strength, lighter", sets: 3, reps: 4, pct: 0.725 },
  { label: "Intensity", sets: 5, reps: 3, pct: 0.825 },
  { label: "Intensity", sets: 5, reps: 3, pct: 0.85 },
  { label: "Intensity", sets: 4, reps: 2, pct: 0.875 },
  { label: "Intensity, lighter", sets: 3, reps: 3, pct: 0.775 },
  { label: "Peak", sets: 3, reps: 2, pct: 0.85, single: 0.9 },
  { label: "Peak", sets: 2, reps: 2, pct: 0.85, single: 0.925 },
  { label: "Taper", sets: 2, reps: 2, pct: 0.775, single: 0.85 },
];

const r2 = (n: number) => Math.round(n * 1000) / 1000;
const mainSets = (w: Wk, fewer = 0): SetRx[] => [...(w.single ? [pct(w.single, 1, 240)] : []), ...sxr(Math.max(1, w.sets - fewer), w.reps, w.pct)];
const variation = (w: Wk): SetRx[] => sxr(Math.max(1, w.sets - 1), w.reps, r2(w.pct - 0.075));
/** Day 4's bench: two more reps at 10% lighter. */
const volume = (w: Wk): SetRx[] => sxr(Math.max(2, w.sets - 1), w.reps + 2, r2(w.pct - 0.1), 150);

function W(w: Wk): WeekRx {
  return week(
    [
      day("Squat and bench", [
        ex("Back squat", mainSets(w), { lift: "squat" }),
        ex("Bench press", mainSets(w), { lift: "bench" }),
        ex("Barbell row", times(3, fixed(range(8, 10), 120)), { progress: false }),
      ]),
      day("Deadlift and close-grip bench", [
        ex("Deadlift", mainSets(w, 1), { lift: "deadlift" }),
        ex("Close-grip bench press", variation(w), { lift: "bench" }),
        ex("Lat pulldown", times(3, fixed(range(8, 12), 90)), { progress: false }),
      ]),
      day("Pause squat and pause bench", [
        ex("Pause squat", variation(w), { lift: "squat", notes: "Pause for two seconds at the bottom." }),
        ex("Pause bench press", variation(w), { lift: "bench", notes: "Pause for a second on the chest." }),
        ex("Back extension", times(3, fixed(range(10, 15), 90)), { bodyweight: true }),
      ]),
      day("Bench volume", [
        ex("Bench press", volume(w), { lift: "bench" }),
        ex("Romanian deadlift", times(3, fixed(range(8, 10), 120)), { progress: false }),
        ex("Dumbbell row", times(3, fixed(range(8, 12), 90)), { progress: false }),
      ]),
    ],
    w.label,
  );
}

export const calgaryStyle: ProgramTemplate = {
  key: "calgary-barbell-style-16-week",
  name: "Calgary Barbell-style 16-week",
  author: "After Calgary Barbell's 16 Week Program",
  family: "peaking",
  level: "intermediate",
  daysPerWeek: 4,
  lengthWeeks: 16,
  lifts: ["squat", "bench", "deadlift"],
  tmPct: 1,
  who: "Intermediate lifters preparing for a meet or a test day four months out.",
  description:
    "Sixteen weeks, four days a week, built like meet prep. Four blocks move from sets of eight down to doubles: hypertrophy, strength, intensity, then a peak with a heavy single before the main sets. The last week of each of the first three blocks is lighter. Squat and bench appear twice a week, with paused and close-grip versions, and deadlift once. Week 16 tests all three lifts. The percentages are ours, in the shape of Calgary Barbell's program.",
  warning: "Ends in a max test on three lifts. Use a spotter or safety bars.",
  summary: "Sixteen weeks of meet prep in four blocks, from sets of eight to heavy singles, ending in a test of all three lifts.",
  phases: [
    { name: "Hypertrophy", fromWeek: 1, toWeek: 4, note: "Sets of seven and eight at 65% to 70% of your max. Week 4 is lighter." },
    { name: "Strength", fromWeek: 5, toWeek: 8, note: "Sets of four and five at 75% to 80%. Week 8 is lighter." },
    { name: "Intensity", fromWeek: 9, toWeek: 12, note: "Sets of two and three at 82.5% to 87.5%. Week 12 is lighter." },
    { name: "Peak", fromWeek: 13, toWeek: 15, note: "A single at 90%, then 92.5%, before doubles at 85%. Week 15 tapers so you go into the test fresh." },
    { name: "Test", fromWeek: 16, toWeek: 16, note: "A max test of squat and bench on one day, then deadlift on another." },
  ],
  whyItWorks:
    "Each block lifts the percentages and cuts the reps, so the work gets more like a meet as it goes. Lighter weeks between blocks let fatigue drop. Paused and close-grip work trains the same lifts at lighter weights. The percentages are ours.",
  engine: { key: "fixed_block" },
  weeks: [
    ...WEEKS.map(W),
    week(
      [day("Squat and bench test", [maxTest("Back squat", "squat"), maxTest("Bench press", "bench")], true), day("Deadlift test", [maxTest("Deadlift", "deadlift")], true)],
      "Test",
    ),
  ],
};
