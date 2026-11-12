// app/src/lib/programs/preview.ts
/**
 * The staff preview: every week of a program as prescribed (percentages,
 * RPE, rep ranges) beside example weights for a lifter whose maxes are all
 * 100 kg. Linear programs show starting weights. Pure.
 */
import { initState } from "./engines";
import { planExercise, setsFor, summarisePlanned, summariseRx, weekLabel } from "./planner";
import type { LiftKey, ProgramTemplate } from "./types";

export interface PreviewRow {
  day: string;
  test: boolean;
  exercise: string;
  rx: string;
  example: string;
}

export interface PreviewWeek {
  label: string;
  rows: PreviewRow[];
}

export function previewProgram(t: ProgramTemplate, maxKg = 100, stepKg = 2.5): PreviewWeek[] {
  const maxes: Partial<Record<LiftKey, number>> = Object.fromEntries(t.lifts.map((l) => [l, maxKg]));
  const base = initState(t, maxes, stepKg);
  return t.weeks.map((w, wi) => {
    const wk = weekLabel(t, { week: wi, cycle: 0 });
    return {
      label: w.label ? `${wk}: ${w.label}` : wk,
      rows: w.days.flatMap((d, di) =>
        d.exercises.map((ex, xi) => {
          const planned = planExercise(ex, xi, { ...base, week: wi, day: di }, { stepKg });
          const example = planned.bodyweight ? "Bodyweight" : planned.sets.some((s) => s.kg !== null) ? summarisePlanned(planned.sets, "kg") : "Member picks the weight";
          return { day: d.name, test: d.test === true, exercise: ex.name, rx: summariseRx(setsFor(ex, base.stages)), example };
        }),
      ),
    };
  });
}
