// app/src/lib/programs/templates/dc.ts
import { day, ex, fixed, range, week } from "../dsl";
import type { DayRx, ExerciseRx, ProgramTemplate } from "../types";

const RP_NOTE =
  "Rest-pause: one set to failure (7 to 10 reps), 15 deep breaths, more reps to failure, 15 breaths, more reps. Log the total of all three goes as one set. Then stretch the muscle hard for 60 seconds.";
const WIDOW_NOTE = "Widowmaker: one set of 20 with a weight you would normally lift about 10 times. Pause and breathe at the top when you need to.";

/** One rest-pause set: 11 to 15 reps in total over three goes. */
const rp = (name: string, min = 11, max = 15): ExerciseRx => ex(name, [fixed(range(min, max), 180)], { notes: RP_NOTE });
/** One straight set to failure. */
const one = (name: string, min: number, max: number, notes?: string): ExerciseRx => ex(name, [fixed(range(min, max), 180)], notes ? { notes } : {});

const A1 = day("Workout A1", [rp("Incline bench press"), rp("Seated dumbbell shoulder press"), rp("Close-grip bench press"), rp("Lat pulldown"), one("Rack pull", 6, 9, "One heavy set to failure. Then stretch the upper back for 60 seconds.")]);
const A2 = day("Workout A2", [rp("Machine chest press"), rp("Overhead press"), rp("Skull crusher"), rp("Close-grip lat pulldown"), one("T-bar row", 10, 12, "One set to failure. Then stretch the upper back for 60 seconds.")]);
const B1 = day("Workout B1", [
  rp("Preacher curl"),
  one("Hammer curl", 10, 20, "One set to failure for the forearms."),
  one("Leg press calf raise", 10, 12, "Pause for 5 seconds in the stretch at the bottom of every rep."),
  rp("Lying leg curl", 15, 25),
  one("Back squat", 4, 8, "One heavy set to failure."),
  ex("Back squat", [fixed(20, 180)], { notes: WIDOW_NOTE }),
]);
const B2 = day("Workout B2", [
  rp("EZ-bar curl"),
  one("Hammer curl", 10, 20, "One set to failure for the forearms."),
  one("Standing calf raise", 10, 12, "Pause for 5 seconds in the stretch at the bottom of every rep."),
  one("Stiff-legged deadlift", 6, 10, "One set to failure. Then stretch the hamstrings for 60 seconds."),
  one("Hack squat", 4, 8, "One heavy set to failure."),
  ex("Leg press", [fixed(20, 180)], { notes: WIDOW_NOTE }),
]);

/** Four workouts in rotation over three days a week: each comes round every eight to nine days. */
const ROTATION: DayRx[][] = [
  [A1, B1, A2],
  [B2, A1, B1],
  [A2, B2, A1],
  [B1, A2, B2],
];

export const dcStyle: ProgramTemplate = {
  key: "dc-style",
  name: "DC-style",
  author: "After Dante Trudel's DC Training",
  family: "size",
  level: "advanced",
  daysPerWeek: 3,
  lengthWeeks: 8,
  lifts: [],
  tmPct: 1,
  who: "Advanced lifters training for muscle who want short, very hard sessions.",
  description:
    "Three days a week, four workouts in rotation. Workout A trains chest, shoulders, triceps and back; workout B trains biceps, forearms, calves, hamstrings and quads. Each exercise is one working set: most are rest-pause sets of 11 to 15 reps in total over three goes, and squats finish with one set of 20. Most sets are followed by a hard stretch of the muscle. Log a rest-pause set as one set with the total reps. When an exercise reaches the top of its range, the weight goes up by your smallest jump. The exercises and ranges are ours.",
  warning: "Every set goes to failure. Learn each lift before you start, and use a spotter or safety bars.",
  summary: "Three short sessions a week of one all-out set per exercise, most of them rest-pause, rotating four workouts.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 2, note: "Each workout comes round once or twice. Pick weights that let you reach the bottom of each range in total." },
    { name: "Build", fromWeek: 3, toWeek: 8, note: "Beat last time's reps or weight on every exercise. When you reach the top of the range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "One all-out set per exercise keeps each session short. Rest-pause packs more reps into that set at a heavy weight. Rotating four workouts trains each muscle about twice in eight or nine days. The exercises and ranges are ours, in the shape of DC Training.",
  engine: { key: "double_progression" },
  weeks: ROTATION.map((days) => week(days)),
};
