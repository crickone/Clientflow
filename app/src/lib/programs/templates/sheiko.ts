// app/src/lib/programs/templates/sheiko.ts
import { day, ex, fixed, maxTest, sxr, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, SetRx } from "../types";

/** [percentage, reps, sets] steps, climbing to the work sets. */
const pyr = (steps: [number, number, number][]): SetRx[] => steps.flatMap(([p, reps, n]) => sxr(n, reps, p));
const lift = (name: string, l: LiftKey) => (steps: [number, number, number][]): ExerciseRx => ex(name, pyr(steps), { lift: l });
const S = lift("Back squat", "squat");
const B = lift("Bench press", "bench");
const D = lift("Deadlift", "deadlift");
const fly = () => ex("Dumbbell fly", times(5, fixed(10, 90)), { progress: false });
const gm = () => ex("Good morning", times(5, fixed(5, 120)), { progress: false });
const ext = () => ex("Back extension", times(3, fixed(10, 90)), { bodyweight: true });

export const sheikoStyle: ProgramTemplate = {
  key: "sheiko-style",
  name: "Sheiko-style",
  author: "After Boris Sheiko's programs",
  family: "peaking",
  level: "advanced",
  daysPerWeek: 3,
  lengthWeeks: 5,
  lifts: ["squat", "bench", "deadlift"],
  tmPct: 1,
  who: "Powerlifters preparing for a meet who respond well to frequent practice.",
  description:
    "The squat, bench and deadlift practised often at moderate weights. Each lift climbs through lighter sets to work sets of doubles and triples between 70% and 85%, three days a week for four weeks, then a test week. The numbers are ours, in Sheiko's style. This is not one of his numbered programs.",
  warning: "Bench three times a week and a lot of total sets. Built for lifters preparing for a meet.",
  engine: { key: "fixed_block" },
  weeks: [
    week([
      day("Day 1", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 2, 5]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), fly()]),
      day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.75, 3, 4]]), B([[0.5, 6, 1], [0.6, 5, 1], [0.7, 4, 4]]), gm()]),
      day("Day 3", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 5]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 4]]), ext()]),
    ]),
    week([
      day("Day 1", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 5]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 4]]), fly()]),
      day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 4]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), gm()]),
      day("Day 3", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), B([[0.55, 5, 1], [0.65, 4, 1], [0.75, 3, 5]]), ext()]),
    ]),
    week([
      day("Day 1", [S([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 2], [0.85, 2, 3]]), B([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 2], [0.85, 1, 3]]), fly()]),
      day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 1], [0.85, 2, 3]]), B([[0.5, 4, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), gm()]),
      day("Day 3", [S([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 2], [0.8, 2, 4]]), B([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 4]]), ext()]),
    ]),
    week(
      [
        day("Day 1", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 4]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 4]])]),
        day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 3]]), B([[0.5, 4, 1], [0.6, 4, 1], [0.7, 4, 3]])]),
        day("Day 3", [S([[0.5, 3, 1], [0.6, 3, 1], [0.7, 2, 2]]), B([[0.5, 3, 1], [0.6, 3, 1], [0.7, 2, 2]])]),
      ],
      "Lighter week",
    ),
    week([day("Squat and bench test", [maxTest("Back squat", "squat"), maxTest("Bench press", "bench")], true), day("Deadlift test", [maxTest("Deadlift", "deadlift")], true)], "Test"),
  ],
};
