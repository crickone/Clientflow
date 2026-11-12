// app/src/lib/programs/templates/greyskull.ts
import { day, ex, fixed, week } from "../dsl";
import type { ProgramTemplate } from "../types";

/** Two sets of five, then a last set for as many reps as you can. */
const twoAndPlus = () => [fixed(5, 180), fixed(5, 180), fixed(5, 180, true)];

const A = day("Workout A", [
  ex("Bench press", twoAndPlus(), { lift: "bench" }),
  ex("Barbell row", twoAndPlus(), { lift: "row" }),
  ex("Back squat", twoAndPlus(), { lift: "squat" }),
]);
const B = day("Workout B", [
  ex("Overhead press", twoAndPlus(), { lift: "press" }),
  ex("Chin-up", twoAndPlus(), { bodyweight: true }),
  ex("Deadlift", [fixed(5, 180, true)], { lift: "deadlift" }),
]);

export const greyskullLp: ProgramTemplate = {
  key: "greyskull-lp",
  name: "Greyskull LP",
  author: "Greyskull LP by John Sheaffer",
  family: "beginner",
  level: "beginner",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: ["bench", "row", "squat", "press", "deadlift"],
  tmPct: 1,
  who: "Newer lifters who like to push the last set.",
  description:
    "Two workouts, alternated three days a week. Two sets of five, then a last set for as many reps as you can. Upper-body lifts go up 2.5 kg a session, or 1.25 kg with small plates. Squat and deadlift go up 2.5 kg. Ten or more reps on the last set doubles the next jump. Fall short of five on any set and that lift drops 10%.",
  summary: "Three full-body sessions a week. Most lifts are two sets of five, then a last set for as many reps as you can. The deadlift is one set of five or more.",
  phases: [
    { name: "Add weight", fromWeek: 1, toWeek: 12, note: "The first sessions start at half your max. Each barbell lift goes up every session you get five on every set. Fall short and it drops 10% straight away. Chin-ups are bodyweight and do not go up." },
  ],
  whyItWorks:
    "The last set tells the program how much you have left. Ten or more reps on it can mean a bigger jump next time. A short set drops the weight at once, so you do not keep grinding at a weight you cannot finish.",
  engine: { key: "linear", increment: 1.25, increments: { squat: 2.5, deadlift: 2.5 }, deloadAfter: 1, deloadPct: 0.1, startPct: 0.5, doubleAt: 10 },
  weeks: [week([A, B, A]), week([B, A, B])],
};
