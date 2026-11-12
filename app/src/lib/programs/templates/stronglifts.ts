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
  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },
  weeks: [week([A, B, A]), week([B, A, B])],
};
