// app/src/lib/programs/templates/wendler.ts
import { amrap, day, ex, fixed, pct, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, WeekRx } from "../types";

/** The 5/3/1 waves as [percentage of training max, reps, last set as many as you can]. */
const WAVES: [number, number, boolean][][] = [
  [[0.65, 5, false], [0.75, 5, false], [0.85, 5, true]],
  [[0.7, 3, false], [0.8, 3, false], [0.9, 3, true]],
  [[0.75, 5, false], [0.85, 3, false], [0.95, 1, true]],
  [[0.4, 5, false], [0.5, 5, false], [0.6, 5, false]],
];
const WEEK_LABELS = ["5s week", "3s week", "5/3/1 week", "Deload"];
const DAYS: { lift: LiftKey; name: string; day: string }[] = [
  { lift: "press", name: "Overhead press", day: "Press day" },
  { lift: "deadlift", name: "Deadlift", day: "Deadlift day" },
  { lift: "bench", name: "Bench press", day: "Bench day" },
  { lift: "squat", name: "Back squat", day: "Squat day" },
];

const main = (w: number) => WAVES[w].map(([p, reps, plus]) => (plus ? amrap(p, reps, 180) : pct(p, reps, 180)));

function wendler(supplemental: (w: number, d: (typeof DAYS)[number]) => ExerciseRx, assistance: Record<LiftKey, ExerciseRx>): WeekRx[] {
  return [0, 1, 2, 3].map((w) =>
    week(
      DAYS.map((d) => day(d.day, [ex(d.name, main(w), { lift: d.lift }), ...(w < 3 ? [supplemental(w, d)] : []), assistance[d.lift]])),
      WEEK_LABELS[w],
    ),
  );
}

const shared = {
  author: "5/3/1 by Jim Wendler",
  family: "strength" as const,
  level: "intermediate" as const,
  daysPerWeek: 4,
  lengthWeeks: 12,
  lifts: ["press", "deadlift", "bench", "squat"] as LiftKey[],
  tmPct: 0.9,
  engine: { key: "tm_cycle" as const, rule: "cycle" as const, increment: 2.5, increments: { squat: 5, deadlift: 5 } },
};

const WAVE_TEXT =
  "Four days a week, one main lift a day: press, deadlift, bench, squat. Three weeks of waves (5s, 3s, then 5/3/1) at percentages of a training max set at 90% of your max, then a deload week. The last set of each wave is as many reps as you can.";
const TM_TEXT = "The training max goes up after each four-week cycle: 2.5 kg on press and bench, 5 kg on squat and deadlift. A lift whose last set fell short of the minimum reps holds for a cycle.";

export const wendlerBbb: ProgramTemplate = {
  ...shared,
  key: "531-bbb",
  name: "5/3/1 Boring But Big",
  who: "Intermediate lifters who want steady strength gains and some size.",
  description: `${WAVE_TEXT} After the main lift: 5 sets of 10 at 50% of the training max, then one assistance exercise. ${TM_TEXT}`,
  weeks: wendler(
    (_w, d) => ex(d.name, times(5, pct(0.5, 10, 90)), { lift: d.lift, notes: "Boring But Big: 5 sets of 10 at 50% of your training max." }),
    {
      press: ex("Chin-up", times(5, fixed(10, 90)), { bodyweight: true }),
      deadlift: ex("Hanging leg raise", times(5, fixed(15, 60)), { bodyweight: true }),
      bench: ex("Dumbbell row", times(5, fixed(10, 90)), { progress: false }),
      squat: ex("Lying leg curl", times(5, fixed(10, 90)), { progress: false }),
      row: ex("Dumbbell row", times(5, fixed(10, 90)), { progress: false }),
    },
  ),
};

export const wendlerFsl: ProgramTemplate = {
  ...shared,
  key: "531-fsl",
  name: "5/3/1 First Set Last",
  who: "Intermediate lifters who want more practice at the main lifts without long sessions.",
  description: `${WAVE_TEXT} After the main lift: 5 sets of 5 at the first set's weight, then one assistance exercise. ${TM_TEXT}`,
  weeks: wendler(
    (w, d) => ex(d.name, times(5, pct(WAVES[w][0][0], 5, 90)), { lift: d.lift, notes: "First Set Last: 5 sets of 5 at your first set's weight." }),
    {
      press: ex("Dip", times(3, fixed(10, 90)), { bodyweight: true }),
      deadlift: ex("Hanging leg raise", times(3, fixed(15, 60)), { bodyweight: true }),
      bench: ex("Dumbbell row", times(3, fixed(10, 90)), { progress: false }),
      squat: ex("Back extension", times(3, fixed(10, 90)), { bodyweight: true }),
      row: ex("Dumbbell row", times(3, fixed(10, 90)), { progress: false }),
    },
  ),
};
