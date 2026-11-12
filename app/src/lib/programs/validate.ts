// app/src/lib/programs/validate.ts
/**
 * The template check: every platform program at test time, and every gym
 * copy on save. Shape (zod), then the rules: canonical exercise names, every
 * percentage between 30% and 110%, every lift an exercise takes a max from is
 * one the program asks for, and a block program ends in a test day. Pure.
 */
import { z } from "zod";

import { isCanonical } from "./exercises";
import { LIFT_LABEL, type LiftKey, type ProgramTemplate } from "./types";

const liftZ = z.enum(["squat", "bench", "deadlift", "press", "row"]);
const countZ = z.number().int().min(1).max(100);
const repsZ = z.union([
  countZ,
  z.object({ min: countZ, max: countZ }).refine((r) => r.max >= r.min, { message: "A rep range's top must be at least its bottom." }),
]);
const restZ = z.number().int().min(0).max(900);
const kgZ = z.number().min(0).max(50);

const setZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pct"), pct: z.number(), reps: countZ, rest: restZ, addKg: z.number().min(-100).max(100).optional(), drives: z.boolean().optional() }),
  z.object({ kind: z.literal("amrap"), pct: z.number(), reps: countZ, rest: restZ, addKg: z.number().min(-100).max(100).optional(), drives: z.boolean().optional() }),
  z.object({ kind: z.literal("rpe"), rpe: z.number().min(5).max(10), reps: countZ, rest: restZ }),
  z.object({ kind: z.literal("fixed"), reps: repsZ, rest: restZ, amrap: z.boolean().optional() }),
  z.object({ kind: z.literal("same_as_last"), reps: repsZ, rest: restZ }),
]);

const exerciseZ = z.object({
  name: z.string().trim().min(1).max(80),
  lift: liftZ.optional(),
  tier: z.enum(["t1", "t2", "t3"]).optional(),
  sets: z.array(setZ).min(1).max(20),
  stages: z.array(z.array(setZ).min(1).max(20)).max(5).optional(),
  bodyweight: z.boolean().optional(),
  progress: z.boolean().optional(),
  startPct: z.number().min(0.2).max(1).optional(),
  joined: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

const dayZ = z.object({ name: z.string().trim().min(1).max(60), exercises: z.array(exerciseZ).min(1).max(20), test: z.boolean().optional() });
const weekZ = z.object({ label: z.string().trim().max(60).optional(), days: z.array(dayZ).min(1).max(7) });
const incrementsZ = z.partialRecord(liftZ, kgZ).optional();

const engineZ = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("linear"),
    increment: kgZ,
    increments: incrementsZ,
    deloadAfter: z.number().int().min(1).max(10),
    deloadPct: z.number().min(0).max(0.5),
    startPct: z.number().min(0.2).max(1),
    doubleAt: z.number().int().min(1).max(50).optional(),
  }),
  z.object({
    key: z.literal("tm_cycle"),
    rule: z.enum(["cycle", "amrap_table", "drive_set", "gzclp"]),
    increment: kgZ,
    increments: incrementsZ,
    amrapTable: z.array(z.object({ minReps: z.number().int().min(0).max(50), kg: kgZ })).max(10).optional(),
    t2ResetKg: kgZ.optional(),
    t3AmrapTarget: z.number().int().min(1).max(100).optional(),
    startPct: z.number().min(0.2).max(1).optional(),
  }),
  z.object({ key: z.literal("fixed_block") }),
  z.object({ key: z.literal("double_progression") }),
  z.object({ key: z.literal("fixed_volume"), increment: kgZ, startPct: z.number().min(0.2).max(1) }),
]);

const templateZ = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  author: z.string().trim().min(1).max(120),
  family: z.enum(["strength", "peaking", "beginner", "size"]),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  daysPerWeek: z.number().int().min(1).max(7),
  lengthWeeks: z.number().int().min(1).max(52),
  lifts: z.array(liftZ).max(5),
  tmPct: z.number().min(0.5).max(1),
  who: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1200),
  warning: z.string().trim().max(200).optional(),
  engine: engineZ,
  weeks: z.array(weekZ).min(1).max(26),
});

export type TemplateCheck = { ok: true; template: ProgramTemplate } | { ok: false; errors: string[] };

/** Shape only. Unknown keys are dropped. */
export function parseTemplate(raw: unknown): TemplateCheck {
  const parsed = templateZ.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "template"}: ${i.message}`) };
  }
  return { ok: true, template: parsed.data as ProgramTemplate };
}

function usesLift(t: ProgramTemplate, lift: LiftKey): boolean {
  return t.weeks.some((w) => w.days.some((d) => d.exercises.some((e) => e.lift === lift)));
}

/** The rules a well-formed template must also meet. */
export function templateErrors(t: ProgramTemplate): string[] {
  const errors: string[] = [];
  t.weeks.forEach((w, wi) =>
    w.days.forEach((d) =>
      d.exercises.forEach((e) => {
        const where = `Week ${wi + 1}, ${d.name}, ${e.name}`;
        if (!isCanonical(e.name)) errors.push(`${where}: not in the exercise list.`);
        for (const s of [...e.sets, ...(e.stages ?? []).flat()]) {
          if (s.kind !== "pct" && s.kind !== "amrap") continue;
          if (s.pct < 0.3 || s.pct > 1.1) errors.push(`${where}: ${Math.round(s.pct * 1000) / 10}% is outside 30% to 110%.`);
          if (!e.lift) errors.push(`${where}: a percentage needs a lift to take it from.`);
        }
        if (e.lift && !t.lifts.includes(e.lift)) errors.push(`${where}: uses the ${LIFT_LABEL[e.lift].toLowerCase()} max, which this program does not ask for.`);
      }),
    ),
  );
  for (const lift of t.lifts) if (!usesLift(t, lift)) errors.push(`No exercise uses the ${LIFT_LABEL[lift].toLowerCase()} max.`);
  if (t.engine.key === "fixed_block" && !t.weeks[t.weeks.length - 1].days.some((d) => d.test)) errors.push("A block program must end in a test day.");
  return [...new Set(errors)].slice(0, 20);
}

export function validateTemplate(raw: unknown): TemplateCheck {
  const p = parseTemplate(raw);
  if (!p.ok) return p;
  const errors = templateErrors(p.template);
  return errors.length ? { ok: false, errors } : p;
}

/** A gym copy must keep every lift the original's engine needs. Says which one is missing. */
export function copyErrors(original: ProgramTemplate, copy: ProgramTemplate): string[] {
  return original.lifts
    .filter((lift) => !usesLift(copy, lift))
    .map((lift) => `This version has no exercise that uses the ${LIFT_LABEL[lift].toLowerCase()} max. ${original.name} needs one.`);
}
