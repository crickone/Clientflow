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

const startKgZ = z.number().min(0).max(600).optional();
const ruleZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("linear"), incKg: z.number().min(0.5).max(50), deloadAfter: z.number().int().min(1).max(10), startKg: startKgZ }),
  z.object({ kind: z.literal("range"), incKg: z.number().min(0.5).max(50).optional(), startKg: startKgZ }),
  z.object({ kind: z.literal("percent") }),
  z.object({ kind: z.literal("rpe") }),
  z.object({ kind: z.literal("manual"), startKg: startKgZ }),
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
  rule: ruleZ.optional(),
});

const dayZ = z.object({ name: z.string().trim().min(1).max(80), exercises: z.array(exerciseZ).min(1).max(20), test: z.boolean().optional() });
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
  z.object({ key: z.literal("own_rules") }),
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

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  who: "line for who it is for",
  description: "description",
  warning: "warning line",
  label: "week label",
  notes: "notes",
};

function at(raw: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = raw;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[k];
  }
  return cur;
}

/** "Week 2, Workout A, exercise 1, set 3": where in the template an issue sits, in the words the editor uses. */
function whereLabel(raw: unknown, path: PropertyKey[]): { where: string; field: string | null } {
  const parts: string[] = [];
  let field: string | null = null;
  let i = 0;
  while (i < path.length) {
    const key = path[i];
    const next = path[i + 1];
    if (key === "weeks" && typeof next === "number") {
      parts.push(`Week ${next + 1}`);
      i += 2;
    } else if (key === "days" && typeof next === "number") {
      const name = at(raw, [...path.slice(0, i + 2), "name"]);
      parts.push(typeof name === "string" && name.trim() ? name.trim() : `Day ${next + 1}`);
      i += 2;
    } else if (key === "exercises" && typeof next === "number") {
      parts.push(`exercise ${next + 1}`);
      i += 2;
    } else if (key === "sets" && typeof next === "number") {
      parts.push(`set ${next + 1}`);
      i += 2;
    } else if (key === "stages" && typeof next === "number") {
      // A stage is a list of sets: "stages.1.0" is progression stage 2, set 1.
      const setNo = path[i + 2];
      parts.push(typeof setNo === "number" ? `progression ${next + 1}, set ${setNo + 1}` : `progression ${next + 1}`);
      i += typeof setNo === "number" ? 3 : 2;
    } else {
      field = typeof key === "string" ? key : null;
      i += 1;
    }
  }
  return { where: parts.join(", "), field };
}

/** A rep count left empty in an editor arrives as nothing or 0. */
function blankReps(v: unknown): boolean {
  return v === undefined || v === null || v === "" || v === 0;
}

function plainMessage(issue: z.core.$ZodIssue, field: string | null, value: unknown): string {
  const max = "maximum" in issue ? Number(issue.maximum) : NaN;
  const label = field ? (FIELD_LABEL[field] ?? field) : "value";
  if (issue.code === "custom") return "the top of the rep range must be at least the bottom.";
  if (issue.path.includes("exercises") && issue.path.includes("rule") && (field === "rule" || field === "kind")) return "pick a rule.";
  switch (field) {
    case "name":
    case "who":
    case "description":
      return issue.code === "too_big" ? `the ${label} is too long (${max} characters at most).` : `add a ${label}.`;
    case "notes":
      return `the notes are too long (${max} characters at most).`;
    case "warning":
    case "label":
      return `the ${label} is too long (${max} characters at most).`;
    case "reps":
    case "min":
    case "max":
      return blankReps(value) ? "add reps." : "reps must be a whole number from 1 to 100.";
    case "incKg":
      return "the weight to add must be between 0.5 and 50 kg.";
    case "deloadAfter":
      return "misses before it gets lighter must be a whole number from 1 to 10.";
    case "startKg":
      return "the starting weight must be between 0 and 600 kg.";
    case "rest":
      return "rest must be between 0 and 900 seconds.";
    case "rpe":
      return "RPE must be between 5 and 10.";
    case "pct":
      return "enter a percentage.";
    case "daysPerWeek":
      return "days a week must be a whole number from 1 to 7.";
    case "lengthWeeks":
      return "length in weeks must be a whole number from 1 to 52.";
    case "kind":
      return "pick a set type.";
    case "days":
      return issue.code === "too_small" ? "add at least one day." : "no more than 7 days.";
    case "exercises":
      return issue.code === "too_small" ? "add at least one exercise." : "no more than 20 exercises in a day.";
    case "sets":
      return issue.code === "too_small" ? "add at least one set." : "no more than 20 sets in an exercise.";
    case "weeks":
      return issue.code === "too_small" ? "add at least one week." : "no more than 26 weeks.";
    default:
      return `the ${label} is not valid.`;
  }
}

/** Shape only. Unknown keys are dropped. Messages read in plain words, with the week, day and exercise they are about. */
export function parseTemplate(raw: unknown): TemplateCheck {
  const parsed = templateZ.safeParse(raw);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => {
      const { where, field } = whereLabel(raw, i.path);
      const msg = plainMessage(i, field, at(raw, i.path));
      return where ? `${where}: ${msg}` : `${msg.charAt(0).toUpperCase()}${msg.slice(1)}`;
    });
    return { ok: false, errors: [...new Set(messages)].slice(0, 10) };
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
      d.exercises.forEach((e, xi) => {
        const where = `Week ${wi + 1}, ${d.name}, ${e.name}`;
        // A member names their own exercises (the gym's library or typed in); library programs use the canonical list.
        if (t.engine.key !== "own_rules" && !isCanonical(e.name)) errors.push(`${where}: not in the exercise list.`);
        // A rule changes the state key, which would orphan the weights stored for a platform program.
        if (t.engine.key !== "own_rules" && e.rule) errors.push(`Week ${wi + 1}, ${d.name}, exercise ${xi + 1}: rules are only for programs you build yourself.`);
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
