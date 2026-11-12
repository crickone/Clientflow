// app/src/lib/programs/templates/startingStrength.ts
import { day, ex, fixed, times, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const threeFives = () => times(3, fixed(5, 180));

const A = day("Workout A", [
  ex("Back squat", threeFives(), { lift: "squat" }),
  ex("Overhead press", threeFives(), { lift: "press" }),
  ex("Deadlift", [fixed(5, 180)], { lift: "deadlift" }),
]);
const B = day("Workout B", [
  ex("Back squat", threeFives(), { lift: "squat" }),
  ex("Bench press", threeFives(), { lift: "bench" }),
  ex("Deadlift", [fixed(5, 180)], { lift: "deadlift" }),
]);

export const startingStrength: ProgramTemplate = {
  key: "starting-strength",
  name: "Starting Strength",
  author: "Starting Strength by Mark Rippetoe",
  family: "beginner",
  level: "beginner",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: ["squat", "press", "bench", "deadlift"],
  tmPct: 1,
  who: "New lifters who want to get strong on the main barbell lifts quickly.",
  description:
    "Two short workouts, A and B, alternated three days a week. Three sets of five on the squat and on the press or bench, then one heavy set of five on the deadlift. The weight goes up every session while you get every rep. Miss reps three sessions in a row on a lift and it drops 10%. This is the first phase of the novice program.",
  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },
  weeks: [week([A, B, A]), week([B, A, B])],
};
