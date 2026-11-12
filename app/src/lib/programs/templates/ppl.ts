// app/src/lib/programs/templates/ppl.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const push = day("Push", [
  ex("Bench press", rs(4, 6, 8, 150)),
  ex("Overhead press", rs(3, 8, 10, 120)),
  ex("Incline dumbbell press", rs(3, 8, 12)),
  ex("Lateral raise", rs(3, 12, 15, 60)),
  ex("Triceps pushdown", rs(3, 10, 12, 60)),
  ex("Overhead triceps extension", rs(3, 10, 12, 60)),
]);
const pull = day("Pull", [
  ex("Barbell row", rs(4, 6, 8, 150)),
  ex("Pull-up", rs(3, 6, 10, 120), { bodyweight: true }),
  ex("Seated cable row", rs(3, 8, 12)),
  ex("Face pull", rs(3, 12, 15, 60)),
  ex("Barbell curl", rs(3, 8, 12, 60)),
  ex("Hammer curl", rs(3, 10, 12, 60)),
]);
const legs = day("Legs", [
  ex("Back squat", rs(4, 6, 8, 180)),
  ex("Romanian deadlift", rs(3, 8, 10, 120)),
  ex("Leg press", rs(3, 10, 12, 120)),
  ex("Lying leg curl", rs(3, 10, 12, 60)),
  ex("Standing calf raise", rs(4, 10, 15, 60)),
]);

export const pushPullLegs: ProgramTemplate = {
  key: "push-pull-legs",
  name: "Push, pull, legs",
  author: "A classic split with no single author",
  family: "size",
  level: "intermediate",
  daysPerWeek: 6,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Lifters who want a simple six-day split.",
  description:
    "A push day (chest, shoulders, triceps), a pull day (back, biceps) and a leg day, each twice a week. A heavier compound lift opens each day, then accessories in higher rep ranges. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its range on every set.",
  engine: { key: "double_progression" },
  weeks: [week([push, pull, legs, push, pull, legs])],
};
