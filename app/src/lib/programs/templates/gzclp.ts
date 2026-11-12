// app/src/lib/programs/templates/gzclp.ts
import { day, ex, fixed, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, SetRx } from "../types";

/** T1: 5x3+, then 6x2+, then 10x1+. */
const T1_STAGES: SetRx[][] = [
  [...times(4, fixed(3, 180)), fixed(3, 180, true)],
  [...times(5, fixed(2, 180)), fixed(2, 180, true)],
  [...times(9, fixed(1, 180)), fixed(1, 180, true)],
];
/** T2: 3x10, then 3x8, then 3x6. */
const T2_STAGES: SetRx[][] = [times(3, fixed(10, 120)), times(3, fixed(8, 120)), times(3, fixed(6, 120))];
/** T3: 3x15 with the last set as many as you can. */
const T3_SETS: SetRx[] = [fixed(15, 60), fixed(15, 60), fixed(15, 60, true)];

const t1 = (name: string, lift: LiftKey): ExerciseRx => ex(name, T1_STAGES[0], { lift, tier: "t1", stages: T1_STAGES, startPct: 0.73 });
const t2 = (name: string, lift: LiftKey): ExerciseRx => ex(name, T2_STAGES[0], { lift, tier: "t2", stages: T2_STAGES, startPct: 0.55 });
const t3 = (name: string): ExerciseRx => ex(name, T3_SETS, { tier: "t3" });

export const gzclp: ProgramTemplate = {
  key: "gzclp",
  name: "GZCLP",
  author: "GZCLP by Cody Lefever",
  family: "strength",
  level: "beginner",
  daysPerWeek: 4,
  lengthWeeks: 12,
  lifts: ["squat", "bench", "press", "deadlift"],
  tmPct: 1,
  who: "Beginners who want a set plan for what to do when a lift stalls.",
  description:
    "Four workouts in rotation. Each has a heavy main lift (T1: 5 x 3 with a last set for as many as you can), a lighter second lift (T2: 3 x 10) and an accessory (T3: 3 x 15 with a last set for as many as you can). Hit your reps and the weight goes up. Miss, and the lift moves to its next rep scheme: 6 x 2 then 10 x 1 for T1, 3 x 8 then 3 x 6 for T2. T3 goes up once the last set reaches 25.",
  summary: "Four workouts in rotation, each with a heavy main lift, a lighter second lift and an accessory.",
  phases: [
    { name: "Build", fromWeek: 1, toWeek: 12, note: "Main lifts start at 73% of your max and second lifts at 55%. You pick accessory weights. Main and second lifts go up each session you hit your reps. A miss moves the lift to its next rep scheme at the same weight. An accessory goes up once its last set reaches 25." },
  ],
  whyItWorks:
    "Each main and second lift has a plan for when it stalls: first the same weight with fewer reps per set. After its last scheme, a main lift goes back to 5 x 3 at 85% of the stalled weight, and a second lift goes back to 3 x 10, 5 kg over its last 3 x 10 start. The three tiers split each session into heavy, medium and light work. Each main lift is trained heavy once every four sessions.",
  engine: { key: "tm_cycle", rule: "gzclp", increment: 2.5, increments: { squat: 5, deadlift: 5 }, t2ResetKg: 5, t3AmrapTarget: 25 },
  weeks: [
    week([
      day("A1", [t1("Back squat", "squat"), t2("Bench press", "bench"), t3("Lat pulldown")]),
      day("B1", [t1("Overhead press", "press"), t2("Deadlift", "deadlift"), t3("Dumbbell row")]),
      day("A2", [t1("Bench press", "bench"), t2("Back squat", "squat"), t3("Lat pulldown")]),
      day("B2", [t1("Deadlift", "deadlift"), t2("Overhead press", "press"), t3("Dumbbell row")]),
    ]),
  ],
};
