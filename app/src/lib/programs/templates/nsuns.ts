// app/src/lib/programs/templates/nsuns.ts
import { amrap, day, ex, pct, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate } from "../types";

type Row = [number, number] | [number, number, "plus"] | [number, number, "drives"];

/** Main lift: nine sets; "drives" is the 1+ set whose reps set next week's training max. */
const t1 = (name: string, lift: LiftKey, rows: Row[]): ExerciseRx =>
  ex(
    name,
    rows.map(([p, reps, tag]) => (tag === "drives" ? amrap(p, reps, 180, { drives: true }) : tag === "plus" ? amrap(p, reps, 180) : pct(p, reps, 180))),
    { lift },
  );
/** Second lift: eight sets off the related lift's training max. */
const t2 = (name: string, lift: LiftKey, rows: [number, number][]): ExerciseRx => ex(name, rows.map(([p, reps]) => pct(p, reps, 120)), { lift });

const HEAVY: Row[] = [[0.75, 5], [0.85, 3], [0.95, 1, "drives"], [0.9, 3], [0.85, 3], [0.8, 3], [0.75, 5], [0.7, 5], [0.65, 5, "plus"]];
const T2_70: [number, number][] = [[0.5, 5], [0.6, 5], [0.7, 3], [0.7, 5], [0.7, 7], [0.7, 4], [0.7, 6], [0.7, 8]];
const T2_60: [number, number][] = [[0.4, 6], [0.5, 5], [0.6, 3], [0.6, 5], [0.6, 7], [0.6, 4], [0.6, 6], [0.6, 8]];

export const nsunsStyle: ProgramTemplate = {
  key: "nsuns-style-5-day",
  name: "nSuns-style 5-day",
  author: "After nSuns' 5/3/1 linear progression",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 5,
  lengthWeeks: 8,
  lifts: ["bench", "squat", "press", "deadlift"],
  tmPct: 0.9,
  who: "Intermediate lifters who like volume and fast weekly progress.",
  description:
    "Five days a week. Each day has a main lift for nine sets that climb to a heavy single and come back down, then a second lift for eight sets. The heavy single is as many reps as you can, and the reps you get set next week's training max: 0 to 1 reps no change, 2 to 3 reps plus 2.5 kg, 4 to 5 reps plus 5 kg, 6 or more plus 7.5 kg.",
  warning: "Long sessions: about 17 working sets a day, five days a week.",
  engine: {
    key: "tm_cycle",
    rule: "amrap_table",
    increment: 0,
    amrapTable: [
      { minReps: 0, kg: 0 },
      { minReps: 2, kg: 2.5 },
      { minReps: 4, kg: 5 },
      { minReps: 6, kg: 7.5 },
    ],
  },
  weeks: [
    week([
      day("Bench and press", [
        t1("Bench press", "bench", [[0.65, 8], [0.75, 6], [0.85, 4], [0.85, 4], [0.85, 4], [0.8, 5], [0.75, 6], [0.7, 7], [0.65, 8, "plus"]]),
        t2("Overhead press", "press", [[0.5, 6], [0.6, 5], [0.7, 3], [0.7, 5], [0.7, 7], [0.7, 4], [0.7, 6], [0.7, 8]]),
      ]),
      day("Squat and sumo", [t1("Back squat", "squat", HEAVY), t2("Sumo deadlift", "deadlift", T2_70)]),
      day("Press and incline", [t1("Overhead press", "press", HEAVY), t2("Incline bench press", "bench", T2_60)]),
      day("Deadlift and front squat", [
        t1("Deadlift", "deadlift", [[0.75, 5], [0.85, 3], [0.95, 1, "drives"], [0.9, 3], [0.85, 3], [0.8, 3], [0.75, 3], [0.7, 3], [0.65, 3, "plus"]]),
        t2("Front squat", "squat", [[0.35, 5], [0.45, 5], [0.55, 3], [0.55, 5], [0.55, 7], [0.55, 4], [0.55, 6], [0.55, 8]]),
      ]),
      day("Bench and close grip", [
        t1("Bench press", "bench", [[0.75, 5], [0.85, 3], [0.95, 1, "drives"], [0.9, 3], [0.85, 5], [0.8, 3], [0.75, 5], [0.7, 3], [0.65, 5, "plus"]]),
        t2("Close-grip bench press", "bench", T2_60),
      ]),
    ]),
  ],
};
