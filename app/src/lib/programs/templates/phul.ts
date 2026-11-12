// app/src/lib/programs/templates/phul.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const upperPower = day("Upper power", [
  ex("Bench press", rs(4, 3, 5, 180)),
  ex("Incline dumbbell press", rs(4, 6, 10)),
  ex("Barbell row", rs(4, 3, 5, 180)),
  ex("Lat pulldown", rs(4, 6, 10)),
  ex("Overhead press", rs(3, 5, 8, 120)),
  ex("Barbell curl", rs(3, 6, 10)),
  ex("Skull crusher", rs(3, 6, 10)),
]);
const lowerPower = day("Lower power", [
  ex("Back squat", rs(4, 3, 5, 180)),
  ex("Deadlift", rs(4, 3, 5, 180)),
  ex("Leg press", rs(4, 10, 15, 120)),
  ex("Lying leg curl", rs(4, 6, 10)),
  ex("Standing calf raise", rs(4, 6, 10, 60)),
]);
const upperHypertrophy = day("Upper hypertrophy", [
  ex("Incline bench press", rs(4, 8, 12)),
  ex("Dumbbell fly", rs(4, 8, 12, 60)),
  ex("Seated cable row", rs(4, 8, 12)),
  ex("Dumbbell row", rs(4, 8, 12)),
  ex("Lateral raise", rs(4, 8, 12, 60)),
  ex("Incline dumbbell curl", rs(4, 8, 12, 60)),
  ex("Triceps pushdown", rs(4, 8, 12, 60)),
]);
const lowerHypertrophy = day("Lower hypertrophy", [
  ex("Front squat", rs(4, 8, 12, 120)),
  ex("Walking lunge", rs(4, 8, 12)),
  ex("Leg extension", rs(4, 10, 15, 60)),
  ex("Lying leg curl", rs(4, 10, 15, 60)),
  ex("Seated calf raise", rs(4, 8, 12, 60)),
  ex("Leg press calf raise", rs(4, 8, 12, 60)),
]);

export const phul: ProgramTemplate = {
  key: "phul",
  name: "PHUL",
  author: "PHUL by Brandon Campbell",
  family: "size",
  level: "intermediate",
  daysPerWeek: 4,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Intermediate lifters who want strength and size on four days a week.",
  description:
    "Power Hypertrophy Upper Lower. An upper and a lower power day with heavy sets of three to five, and an upper and a lower hypertrophy day with sets of eight to fifteen. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its rep range on every set.",
  engine: { key: "double_progression" },
  weeks: [week([upperPower, lowerPower, upperHypertrophy, lowerHypertrophy])],
};
