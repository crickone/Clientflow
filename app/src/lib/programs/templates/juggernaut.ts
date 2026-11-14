// app/src/lib/programs/templates/juggernaut.ts
import { amrap, day, ex, fixed, pct, range, sxr, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, SetRx, WeekRx } from "../types";

/** One wave: its rep target, and the percentages of the training max for each of its weeks. */
interface Wave {
  reps: number;
  accumulation: { sets: number; pct: number };
  intensification: { sets: number; pct: number };
  /** The + set: as many reps as you can, at least the target. */
  realization: number;
}

const WAVES: Wave[] = [
  { reps: 10, accumulation: { sets: 5, pct: 0.6 }, intensification: { sets: 3, pct: 0.675 }, realization: 0.75 },
  { reps: 8, accumulation: { sets: 5, pct: 0.65 }, intensification: { sets: 3, pct: 0.725 }, realization: 0.8 },
  { reps: 5, accumulation: { sets: 6, pct: 0.7 }, intensification: { sets: 4, pct: 0.775 }, realization: 0.85 },
  { reps: 3, accumulation: { sets: 7, pct: 0.75 }, intensification: { sets: 5, pct: 0.825 }, realization: 0.9 },
];

const DAYS: { lift: LiftKey; name: string; day: string; extra: ExerciseRx }[] = [
  { lift: "squat", name: "Back squat", day: "Squat day", extra: ex("Lying leg curl", times(3, fixed(range(10, 15), 90)), { progress: false }) },
  { lift: "bench", name: "Bench press", day: "Bench day", extra: ex("Dumbbell row", times(4, fixed(range(8, 12), 90)), { progress: false }) },
  { lift: "deadlift", name: "Deadlift", day: "Deadlift day", extra: ex("Hanging leg raise", times(3, fixed(range(10, 15), 60)), { bodyweight: true }) },
  { lift: "press", name: "Overhead press", day: "Press day", extra: ex("Chin-up", times(4, fixed(range(6, 10), 90)), { bodyweight: true }) },
];

const PLUS_NOTE = "As many reps as you can with good form. Each rep past the target moves your training max for the rest of the program.";

function waveWeeks(w: Wave): WeekRx[] {
  const phase = (label: string, sets: (d: (typeof DAYS)[number]) => SetRx[], notes?: string) =>
    week(
      DAYS.map((d) => day(d.day, [ex(d.name, sets(d), { lift: d.lift, ...(notes ? { notes } : {}) }), d.extra])),
      `${w.reps}s wave: ${label}`,
    );
  return [
    phase("accumulation", () => sxr(w.accumulation.sets, w.reps, w.accumulation.pct)),
    phase("intensification", () => sxr(w.intensification.sets, w.reps, w.intensification.pct)),
    phase("realization", () => [pct(0.5, 5, 120), pct(0.6, 3, 150), pct(0.7, 1, 180), amrap(w.realization, w.reps, 240, { drives: true })], PLUS_NOTE),
    phase("deload", () => [pct(0.4, 5, 90), pct(0.5, 5, 90), pct(0.6, 5, 90)]),
  ];
}

export const juggernautStyle: ProgramTemplate = {
  key: "juggernaut-style",
  name: "Juggernaut-style",
  author: "After Chad Wesley Smith's Juggernaut Method",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 4,
  lengthWeeks: 16,
  lifts: ["squat", "bench", "deadlift", "press"],
  tmPct: 0.9,
  who: "Intermediate lifters who want steady strength with a lot of practice at each lift.",
  description:
    "Sixteen weeks, four days a week, one main lift a day. Four waves of four weeks: sets of ten, then eight, then five, then three. In each wave the first week has the most sets, the second is heavier with fewer sets, the third ends in one set for as many reps as you can, and the fourth is a deload. Every percentage is of a training max set at 90% of your max. The reps you beat the target by on the + set raise that lift's training max for the waves that follow. The percentages and jumps are ours.",
  summary: "Four waves of tens, eights, fives and threes. Each wave ends in a + set, and the reps you beat the target by raise your training max.",
  phases: [
    { name: "10s wave", fromWeek: 1, toWeek: 4, note: "Sets of ten at 60% and 67.5% of your training max, then a 10+ set at 75%, then a deload week." },
    { name: "8s wave", fromWeek: 5, toWeek: 8, note: "Sets of eight at 65% and 72.5%, then an 8+ set at 80%, then a deload week." },
    { name: "5s wave", fromWeek: 9, toWeek: 12, note: "Sets of five at 70% and 77.5%, then a 5+ set at 85%, then a deload week." },
    { name: "3s wave", fromWeek: 13, toWeek: 16, note: "Sets of three at 75% and 82.5%, then a 3+ set at 90%, then a deload week." },
  ],
  whyItWorks:
    "Each wave starts with lots of practice at a rep count, then gets heavier with fewer sets. The + set at the end of the wave shows how much stronger you are, and the training max moves by that much. The deload weeks let fatigue drop before the next wave. The percentages and jumps are ours.",
  engine: { key: "tm_cycle", rule: "reps_over", increment: 1.25, increments: { squat: 2.5, deadlift: 2.5 } },
  weeks: WAVES.flatMap(waveWeeks),
};
