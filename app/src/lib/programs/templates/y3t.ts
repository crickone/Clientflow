// app/src/lib/programs/templates/y3t.ts
import { day, ex, rs, week } from "../dsl";
import type { ExerciseRx, ProgramTemplate, WeekRx } from "../types";

/** The three weeks: rep ranges and rest for compounds and isolations. */
interface Band {
  label: string;
  compound: [number, number, number, number];
  isolation: [number, number, number, number];
}
// [sets, min reps, max reps, rest]
const BANDS: Band[] = [
  { label: "Heavy week", compound: [4, 6, 8, 180], isolation: [3, 8, 10, 90] },
  { label: "Mixed week", compound: [4, 8, 12, 120], isolation: [3, 10, 12, 75] },
  { label: "High-rep week", compound: [3, 15, 20, 75], isolation: [3, 20, 30, 45] },
];

const DAYS: { name: string; compounds: string[]; isolations: string[] }[] = [
  { name: "Legs", compounds: ["Back squat", "Leg press", "Romanian deadlift"], isolations: ["Leg extension", "Lying leg curl", "Standing calf raise"] },
  { name: "Chest", compounds: ["Incline bench press", "Dumbbell bench press"], isolations: ["Incline dumbbell fly", "Cable crossover"] },
  { name: "Back", compounds: ["Barbell row", "Lat pulldown", "Seated cable row"], isolations: ["Dumbbell shrug"] },
  { name: "Shoulders", compounds: ["Seated dumbbell shoulder press", "Upright row"], isolations: ["Lateral raise", "Rear delt fly", "Face pull"] },
  { name: "Arms", compounds: ["Close-grip bench press", "EZ-bar curl"], isolations: ["Skull crusher", "Hammer curl", "Triceps pushdown", "Preacher curl"] },
];

const HIGH_NOTE = "High-rep week: done back to back with the exercise above, with little rest.";

function W(b: Band, w: number): WeekRx {
  const make = (name: string, [n, min, max, rest]: Band["compound"], joined = false): ExerciseRx =>
    ex(name, rs(n, min, max, rest), joined ? { joined: true, notes: HIGH_NOTE } : {});
  return week(
    DAYS.map((d) =>
      day(d.name, [
        ...d.compounds.map((name) => make(name, b.compound)),
        // In the high-rep week, isolations run back to back in pairs.
        ...d.isolations.map((name, k) => make(name, b.isolation, w === 2 && k % 2 === 1)),
      ]),
    ),
    b.label,
  );
}

export const y3tStyle: ProgramTemplate = {
  key: "y3t-style",
  name: "Y3T-style",
  author: "After Neil Hill's Y3T",
  family: "size",
  level: "intermediate",
  daysPerWeek: 5,
  lengthWeeks: 9,
  lifts: [],
  tmPct: 1,
  who: "Intermediate lifters training for muscle who like changing the rep range week to week.",
  description:
    "Five days a week, one body part a day: legs, chest, back, shoulders, arms. Three weeks repeat: a heavy week of sets of six to ten, a mixed week of eight to twelve, and a high-rep week of fifteen to thirty with isolations done back to back. Each week keeps its own weights, so the heavy week builds on the last heavy week. When every set of an exercise reaches the top of its range, the weight goes up by your smallest jump. The rep ranges and exercises are ours.",
  summary: "Five days a week, one body part a day, rotating a heavy week, a mixed week and a high-rep week.",
  phases: [
    { name: "Heavy week", fromWeek: 1, toWeek: 1, note: "Compounds 4 x 6-8 with long rests, isolations 3 x 8-10." },
    { name: "Mixed week", fromWeek: 2, toWeek: 2, note: "Compounds 4 x 8-12, isolations 3 x 10-12." },
    { name: "High-rep week", fromWeek: 3, toWeek: 3, note: "Compounds 3 x 15-20 and isolations 3 x 20-30 on short rests, in back-to-back pairs." },
  ],
  phasesRepeat: true,
  whyItWorks:
    "Each muscle is trained with heavy, medium and light weights over three weeks. The high-rep week is lighter on the joints, which gives them a break before the next heavy week. The rep ranges and exercises are ours.",
  engine: { key: "double_progression" },
  weeks: BANDS.map(W),
};
