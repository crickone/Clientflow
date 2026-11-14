// app/src/lib/programs/templates/upperLower.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

export const upperLower: ProgramTemplate = {
  key: "upper-lower-4-day",
  name: "Upper/lower 4-day",
  author: "Our version of the classic upper and lower split",
  family: "size",
  level: "beginner",
  daysPerWeek: 4,
  lengthWeeks: 8,
  lifts: [],
  tmPct: 1,
  who: "Lifters who want a plain, steady muscle-building plan on four days a week.",
  description:
    "Four days a week: two upper-body days and two lower-body days, each with a heavier compound lift first and lighter work after. Every exercise has a rep range. When every set reaches the top of it, the weight goes up by your smallest jump and the reps go back to the bottom.",
  summary: "Two upper and two lower days a week, with rep ranges and a weight jump when you reach the top of each range.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Pick a weight for each exercise that lets you reach the bottom of its rep range on every set." },
    { name: "Build", fromWeek: 2, toWeek: 8, note: "Add reps each session. When every set reaches the top of the range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "Each muscle is trained twice a week, which spreads the work over shorter sessions. Rep ranges let you add reps before you add weight, so the weight goes up only when you are ready for it.",
  engine: { key: "double_progression" },
  weeks: [
    week([
      day("Upper A", [
        ex("Bench press", rs(3, 6, 10, 180)),
        ex("Barbell row", rs(3, 6, 10, 150)),
        ex("Seated dumbbell shoulder press", rs(3, 8, 12)),
        ex("Lat pulldown", rs(3, 8, 12)),
        ex("EZ-bar curl", rs(2, 10, 15, 60)),
        ex("Triceps pushdown", rs(2, 10, 15, 60)),
      ]),
      day("Lower A", [
        ex("Back squat", rs(3, 6, 10, 180)),
        ex("Romanian deadlift", rs(3, 8, 12, 150)),
        ex("Lying leg curl", rs(3, 10, 15, 60)),
        ex("Standing calf raise", rs(3, 10, 15, 60)),
        ex("Hanging leg raise", rs(3, 10, 15, 60), { bodyweight: true }),
      ]),
      day("Upper B", [
        ex("Incline dumbbell press", rs(3, 8, 12)),
        ex("Chest-supported row", rs(3, 8, 12)),
        ex("Lateral raise", rs(3, 12, 15, 60)),
        ex("Close-grip lat pulldown", rs(3, 8, 12)),
        ex("Hammer curl", rs(2, 10, 15, 60)),
        ex("Overhead triceps extension", rs(2, 10, 15, 60)),
      ]),
      day("Lower B", [
        ex("Deadlift", rs(3, 5, 8, 180)),
        ex("Hack squat", rs(3, 8, 12, 150)),
        ex("Walking lunge", rs(2, 10, 12)),
        ex("Seated leg curl", rs(3, 10, 15, 60)),
        ex("Seated calf raise", rs(3, 12, 15, 60)),
      ]),
    ]),
  ],
};
