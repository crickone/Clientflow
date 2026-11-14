// app/src/lib/programs/startInput.ts
import "server-only";
import { z } from "zod";

import { bestLoggedSet } from "@/lib/programs/enrolments";
import { LIFT_LABEL, type LiftKey, type WeightUnit } from "@/lib/programs/types";
import { maxFromSet, unitToKg } from "@/lib/programs/units";

// The start-a-program input and max resolution, shared by the member start
// flow and the staff assign action.

/** A real calendar date from a week ago to a year ahead. */
function saneStartDate(v: string): boolean {
  const ms = Date.parse(`${v}T12:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== v) return false;
  const day = 86400000;
  return ms >= Date.now() - 7 * day && ms <= Date.now() + 366 * day;
}

const liftZ = z.enum(["squat", "bench", "deadlift", "press", "row"]);
export const maxEntryZ = z.object({
  lift: liftZ,
  kind: z.enum(["one_rm", "set", "logged"]),
  /** In the member's unit. */
  weight: z.number().min(5).max(1500).nullable(),
  reps: z.number().int().min(1).max(30).nullable(),
});
export const startZ = z.object({
  key: z.string().min(1).max(80),
  unit: z.enum(["kg", "lb"]),
  step: z.enum(["2.5kg", "1.25kg", "5lb"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(saneStartDate, "Pick a start date between last week and a year from now."),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  maxes: z.array(maxEntryZ).max(5),
});

export type MaxEntry = z.infer<typeof maxEntryZ>;
export type StartProgramInput = z.infer<typeof startZ>;

/** Each lift's max in kg: a 1-rep max, a recent set (Epley, 10 reps or fewer) or the best logged set. */
export function resolveMaxes(clientId: number, unit: WeightUnit, entries: MaxEntry[]): { ok: true; kg: Partial<Record<LiftKey, number>> } | { ok: false; error: string } {
  const kg: Partial<Record<LiftKey, number>> = {};
  for (const m of entries) {
    const label = LIFT_LABEL[m.lift].toLowerCase();
    if (m.kind === "logged") {
      const best = bestLoggedSet(clientId, m.lift);
      if (!best) return { ok: false, error: `No ${label} logged in the last 90 days. Enter a max instead.` };
      kg[m.lift] = best.e1rm;
    } else if (m.kind === "one_rm") {
      if (!m.weight) return { ok: false, error: `Enter your ${label} max.` };
      kg[m.lift] = unitToKg(m.weight, unit);
    } else {
      const e1rm = m.weight && m.reps ? maxFromSet(unitToKg(m.weight, unit), m.reps) : null;
      if (e1rm === null) return { ok: false, error: `Use a ${label} set of 10 reps or fewer.` };
      kg[m.lift] = e1rm;
    }
  }
  return { ok: true, kg };
}

