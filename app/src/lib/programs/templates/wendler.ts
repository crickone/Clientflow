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
const TM_TEXT =
  "The training max goes up after each four-week cycle: 2.5 kg on press and bench, 5 kg on squat and deadlift. If you miss the minimum reps on a lift's + set (the last set of a wave), that lift's training max stays the same for the next cycle. This hold is our rule.";

export const wendlerBbb: ProgramTemplate = {
  ...shared,
  key: "531-bbb",
  name: "5/3/1 Boring But Big",
  who: "Intermediate lifters who want steady strength gains and some size.",
  description: `${WAVE_TEXT} After the main lift: 5 sets of 10 at 50% of the training max, then one assistance exercise. ${TM_TEXT}`,
  summary: "Four days a week, one main lift a day, then five sets of ten. The training max goes up each cycle.",
  phases: [
    { name: "5s week", fromWeek: 1, toWeek: 1, note: "Sets of five at 65%, 75% and 85% of your training max, the last one for as many reps as you can. Then 5 x 10 at 50%." },
    { name: "3s week", fromWeek: 2, toWeek: 2, note: "Sets of three at 70%, 80% and 90%, the last one for as many reps as you can. Then 5 x 10 at 50%." },
    { name: "5/3/1 week", fromWeek: 3, toWeek: 3, note: "Five at 75%, three at 85%, then as many as you can at 95%. Then 5 x 10 at 50%. The heaviest week." },
    { name: "Deload", fromWeek: 4, toWeek: 4, note: "Light sets of five at 40%, 50% and 60%, and no 5 x 10. The next cycle starts after it." },
  ],
  phasesRepeat: true,
  whyItWorks:
    "Your training max is 90% of your max, so the main sets start lighter than you can lift. That leaves room to beat the reps on the last set. The training max rises a little each cycle, which keeps the climb slow and steady. The 5 x 10 adds volume for size.",
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
  summary: "Four days a week, one main lift a day, then five sets of five at your first set's weight.",
  phases: [
    { name: "5s week", fromWeek: 1, toWeek: 1, note: "Sets of five at 65%, 75% and 85% of your training max, the last one for as many reps as you can. Then 5 x 5 at 65%." },
    { name: "3s week", fromWeek: 2, toWeek: 2, note: "Sets of three at 70%, 80% and 90%, the last one for as many reps as you can. Then 5 x 5 at 70%." },
    { name: "5/3/1 week", fromWeek: 3, toWeek: 3, note: "Five at 75%, three at 85%, then as many as you can at 95%. Then 5 x 5 at 75%. The heaviest week." },
    { name: "Deload", fromWeek: 4, toWeek: 4, note: "Light sets of five at 40%, 50% and 60%, and no 5 x 5. The next cycle starts after it." },
  ],
  phasesRepeat: true,
  whyItWorks:
    "The extra sets use the lightest weight of the day, so you get more practice at the main lift without much extra strain. The sessions stay shorter than Boring But Big. The training max starts at 90% of your max and rises a little each cycle.",
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
