// app/src/lib/programs/templates/arnold.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const chestBack = day("Chest and back", [
  ex("Bench press", rs(4, 8, 12)),
  ex("Incline bench press", rs(4, 8, 12)),
  ex("Dumbbell fly", rs(3, 10, 12, 60)),
  ex("Pull-up", rs(4, 8, 12), { bodyweight: true }),
  ex("Barbell row", rs(4, 8, 12)),
  ex("Seated cable row", rs(3, 10, 12, 60)),
]);
const shouldersArms = day("Shoulders and arms", [
  ex("Overhead press", rs(4, 8, 12)),
  ex("Lateral raise", rs(3, 10, 12, 60)),
  ex("Rear delt fly", rs(3, 10, 12, 60)),
  ex("Barbell curl", rs(4, 8, 12, 60)),
  ex("Incline dumbbell curl", rs(3, 10, 12, 60)),
  ex("Skull crusher", rs(4, 8, 12, 60)),
  ex("Triceps pushdown", rs(3, 10, 12, 60)),
]);
const legs = day("Legs", [
  ex("Back squat", rs(4, 8, 12, 120)),
  ex("Romanian deadlift", rs(4, 8, 12, 120)),
  ex("Leg extension", rs(3, 12, 15, 60)),
  ex("Lying leg curl", rs(3, 10, 12, 60)),
  ex("Walking lunge", rs(3, 10, 12)),
  ex("Standing calf raise", rs(4, 12, 15, 60)),
]);

export const arnoldStyle: ProgramTemplate = {
  key: "arnold-style-split",
  name: "Arnold-style split",
  author: "After Arnold Schwarzenegger's split",
  family: "size",
  level: "advanced",
  daysPerWeek: 6,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Experienced lifters who want to train each muscle twice a week.",
  description:
    "Chest and back, shoulders and arms, then legs, each twice a week over six days. Sets of eight to fifteen. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its range on every set. The split is his; the exercise choice and set counts are ours.",
  warning: "Six sessions a week. Plan your recovery and food around it.",
  summary: "Six days a week: chest and back, shoulders and arms, then legs, each twice.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "The first time you do each workout, pick a weight for each exercise that lets you reach the bottom of its rep range on every set. From the second time on, add reps." },
    { name: "Build", fromWeek: 2, toWeek: 12, note: "Add reps each session. When every set reaches the top of the range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "Each muscle group gets two sessions a week with plenty of sets of eight to fifteen. Pairing chest with back and shoulders with arms keeps each session to two areas. The split is his; the exercise choice and set counts are ours.",
  engine: { key: "double_progression" },
  weeks: [week([chestBack, shouldersArms, legs, chestBack, shouldersArms, legs])],
};
