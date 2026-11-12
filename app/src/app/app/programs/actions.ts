// app/src/app/app/programs/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { memberSeesPrograms } from "@/lib/programs/access";
import { bestLoggedSet, enrol } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { LIFT_LABEL, type LiftKey, type WeightUnit } from "@/lib/programs/types";
import { maxFromSet, stepFromKey, unitToKg } from "@/lib/programs/units";

// The member's own program. Every action takes the member from their client
// session; lib/programs/enrolments only ever touches that member's enrolment.

type Result = { ok: true } | { ok: false; error: string };
const OFF = { ok: false as const, error: "Programs aren't switched on for you." };

const liftZ = z.enum(["squat", "bench", "deadlift", "press", "row"]);
const maxEntryZ = z.object({
  lift: liftZ,
  kind: z.enum(["one_rm", "set", "logged"]),
  /** In the member's unit. */
  weight: z.number().min(0).max(1500).nullable(),
  reps: z.number().int().min(1).max(30).nullable(),
});
const startZ = z.object({
  key: z.string().min(1).max(80),
  unit: z.enum(["kg", "lb"]),
  step: z.enum(["2.5kg", "1.25kg", "5lb"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  maxes: z.array(maxEntryZ).max(5),
});

export type MaxEntry = z.infer<typeof maxEntryZ>;
export type StartProgramInput = z.infer<typeof startZ>;

function member() {
  const c = requireClient();
  return memberSeesPrograms(c) ? c : null;
}

/** Each lift's max in kg: a 1-rep max, a recent set (Epley, 10 reps or fewer) or the best logged set. */
function resolveMaxes(clientId: number, unit: WeightUnit, entries: MaxEntry[]): { ok: true; kg: Partial<Record<LiftKey, number>> } | { ok: false; error: string } {
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

export async function startProgramAction(raw: unknown): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const p = startZ.safeParse(raw);
  if (!p.success) return { ok: false, error: "Check your entries and try again." };
  const v = p.data;
  if ((v.unit === "lb") !== (v.step === "5lb")) return { ok: false, error: "Pick a smallest jump in the same unit." };
  if (!programByKey(v.key)) return { ok: false, error: "That program isn't available." };
  const maxes = resolveMaxes(c.clientId, v.unit, v.maxes);
  if (!maxes.ok) return maxes;
  const r = enrol(c.clientId, { key: v.key, maxesKg: maxes.kg, unit: v.unit, stepKg: stepFromKey(v.step), startDate: v.startDate, weekdays: v.weekdays });
  if (!r.ok) return r;
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
  return { ok: true };
}
