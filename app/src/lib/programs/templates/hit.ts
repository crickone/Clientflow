// app/src/lib/programs/templates/hit.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const one = (min: number, max: number, rest = 120) => rs(1, min, max, rest);

const A = day("Workout A", [
  ex("Leg press", one(8, 12)),
  ex("Lying leg curl", one(8, 12)),
  ex("Standing calf raise", one(12, 15, 90)),
  ex("Machine chest press", one(6, 10)),
  ex("Lat pulldown", one(6, 10)),
  ex("Seated dumbbell shoulder press", one(6, 10)),
  ex("Barbell curl", one(6, 10, 90)),
]);
const B = day("Workout B", [
  ex("Deadlift", one(5, 8, 180)),
  ex("Leg extension", one(8, 12)),
  ex("Dip", one(6, 10), { bodyweight: true }),
  ex("Chin-up", one(6, 10), { bodyweight: true }),
  ex("Dumbbell row", one(6, 10)),
  ex("Lateral raise", one(8, 12, 90)),
  ex("Triceps pushdown", one(6, 10, 90)),
]);

export const hitStyle: ProgramTemplate = {
  key: "hit-style-full-body",
  name: "HIT-style full body",
  author: "After Arthur Jones and Mike Mentzer",
  family: "size",
  level: "intermediate",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Busy lifters who want short, hard sessions three days a week.",
  description:
    "Two full-body workouts, alternated three days a week. Warm up, then one work set per exercise, taken to failure. When you reach the top of the rep range, the weight goes up by your smallest jump next time. The workouts are ours, in the high-intensity style.",
  warning: "Every work set goes to failure. Use a spotter on presses.",
  summary: "Three short full-body sessions a week. One hard set per exercise, taken to failure.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Warm up, then pick a weight for each exercise that lets you reach the bottom of its rep range on your one work set." },
    { name: "Build", fromWeek: 2, toWeek: 12, note: "When your work set reaches the top of the range, the weight goes up by your smallest jump next time." },
  ],
  whyItWorks:
    "One all-out set per exercise keeps the sessions short. Every session covers the whole body, with two workouts taking turns. The workouts are ours, in the high-intensity style.",
  engine: { key: "double_progression" },
  weeks: [week([A, B, A]), week([B, A, B])],
};
