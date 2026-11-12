// app/src/lib/programs/templates/stronglifts.ts
import { day, ex, fixed, times, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const fives = () => times(5, fixed(5, 180));

const A = day("Workout A", [
  ex("Back squat", fives(), { lift: "squat" }),
  ex("Bench press", fives(), { lift: "bench" }),
  ex("Barbell row", fives(), { lift: "row" }),
]);
const B = day("Workout B", [
  ex("Back squat", fives(), { lift: "squat" }),
  ex("Overhead press", fives(), { lift: "press" }),
  ex("Deadlift", [fixed(5, 180)], { lift: "deadlift" }),
]);

export const strongLifts: ProgramTemplate = {
  key: "stronglifts-5x5",
  name: "StrongLifts 5x5",
  author: "StrongLifts 5x5 by Mehdi Hadim",
  family: "beginner",
  level: "beginner",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: ["squat", "bench", "row", "press", "deadlift"],
  tmPct: 1,
  who: "New lifters, and anyone coming back to the barbell after a long break.",
  description:
    "Two workouts, A and B, alternated three days a week. You squat every session. Every lift is five sets of five except the deadlift, which is one set of five. Get every rep and the weight goes up next time: 2.5 kg, or 5 kg on the deadlift. Miss reps three sessions in a row on a lift and it drops 10%.",
  summary: "Three full-body sessions a week, five sets of five on most lifts. Each lift goes up every session you get all your reps.",
  phases: [
    { name: "Add weight", fromWeek: 1, toWeek: 12, note: "The first sessions start at half your max. Each lift goes up every session you get all your reps. Miss reps three sessions in a row on a lift and it drops 10%." },
  ],
  whyItWorks:
    "You do the same five lifts often, and each one gets a little heavier every time you get all your reps. You squat in each session, so the squat gets the most practice. When a lift stalls, the 10% drop gives you a few lighter sessions before you try the weight again.",
  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },
  weeks: [week([A, B, A]), week([B, A, B])],
};
