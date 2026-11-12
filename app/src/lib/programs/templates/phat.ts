// app/src/lib/programs/templates/phat.ts
import { day, ex, fixed, rs, times, week } from "../dsl";
import type { ExerciseRx, ProgramTemplate } from "../types";

const speed = (name: string, what: string): ExerciseRx =>
  ex(name, times(6, fixed(3, 90)), { progress: false, notes: `Speed sets: about 65 to 70% of your ${what} weight from the power day, moved fast.` });

const upperPower = day("Upper power", [
  ex("Pendlay row", rs(3, 3, 5, 180)),
  ex("Pull-up", rs(2, 6, 10, 120), { bodyweight: true }),
  ex("Chin-up", rs(2, 6, 10, 120), { bodyweight: true }),
  ex("Dumbbell bench press", rs(3, 3, 5, 180)),
  ex("Dip", rs(2, 6, 10, 120), { bodyweight: true }),
  ex("Seated dumbbell shoulder press", rs(3, 6, 10, 120)),
  ex("EZ-bar curl", rs(3, 6, 10)),
  ex("Skull crusher", rs(3, 6, 10)),
]);
const lowerPower = day("Lower power", [
  ex("Back squat", rs(3, 3, 5, 180)),
  ex("Hack squat", rs(2, 6, 10, 120)),
  ex("Leg extension", rs(2, 6, 10)),
  ex("Stiff-legged deadlift", rs(3, 5, 8, 120)),
  ex("Lying leg curl", rs(2, 6, 10)),
  ex("Standing calf raise", rs(3, 6, 10, 60)),
  ex("Seated calf raise", rs(2, 6, 10, 60)),
]);
const backShoulders = day("Back and shoulders", [
  speed("Pendlay row", "row"),
  ex("Chin-up", rs(3, 8, 12), { bodyweight: true }),
  ex("Seated cable row", rs(3, 8, 12)),
  ex("Dumbbell shrug", rs(2, 12, 15, 60)),
  ex("Close-grip lat pulldown", rs(2, 15, 20, 60)),
  ex("Seated dumbbell shoulder press", rs(3, 8, 12)),
  ex("Upright row", rs(2, 12, 15, 60)),
  ex("Lateral raise", rs(3, 12, 20, 60)),
]);
const lowerHypertrophy = day("Lower hypertrophy", [
  speed("Back squat", "squat"),
  ex("Hack squat", rs(3, 8, 12, 120)),
  ex("Leg press", rs(2, 12, 15)),
  ex("Leg extension", rs(3, 15, 20, 60)),
  ex("Romanian deadlift", rs(3, 8, 12, 120)),
  ex("Lying leg curl", rs(2, 12, 15, 60)),
  ex("Seated leg curl", rs(2, 15, 20, 60)),
  ex("Donkey calf raise", rs(4, 10, 15, 60)),
  ex("Seated calf raise", rs(3, 15, 20, 60)),
]);
const chestArms = day("Chest and arms", [
  speed("Dumbbell bench press", "dumbbell press"),
  ex("Incline dumbbell press", rs(3, 8, 12)),
  ex("Machine chest press", rs(3, 12, 15)),
  ex("Incline cable fly", rs(2, 15, 20, 60)),
  ex("Preacher curl", rs(3, 8, 12, 60)),
  ex("Concentration curl", rs(2, 12, 15, 60)),
  ex("Spider curl", rs(2, 15, 20, 60)),
  ex("Overhead triceps extension", rs(3, 8, 12, 60)),
  ex("Triceps pushdown", rs(2, 12, 15, 60)),
  ex("Cable triceps kickback", rs(2, 15, 20, 60)),
]);

export const phat: ProgramTemplate = {
  key: "phat",
  name: "PHAT",
  author: "PHAT by Layne Norton",
  family: "size",
  level: "advanced",
  daysPerWeek: 5,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Experienced lifters who can train five days a week.",
  description:
    "Power Hypertrophy Adaptive Training. Two power days, upper and lower, with heavy sets of three to five, then three hypertrophy days. Each hypertrophy day opens with six fast sets of three at about 65 to 70% of your power-day weight. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its rep range on every set. Rack chins are listed as chin-ups.",
  warning: "Five long sessions a week. Plan your recovery and food around it.",
  engine: { key: "double_progression" },
  weeks: [week([upperPower, lowerPower, backShoulders, lowerHypertrophy, chestArms])],
};
