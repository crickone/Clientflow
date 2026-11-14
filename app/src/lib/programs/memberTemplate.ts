// app/src/lib/programs/memberTemplate.ts
/**
 * Member-built programs (docs/superpowers/specs/2026-11-12-member-built-programs-design.md):
 * the fields a member never picks, the builder's limits, and the check a
 * member program must pass before it is saved. Pure.
 */
import { mostDays } from "./editing";
import { LIFT_KEYS, type ExerciseRx, type LiftKey, type ProgramTemplate } from "./types";
import { parseTemplate, templateErrors, type TemplateCheck } from "./validate";

export const MEMBER_LIMITS = { weeks: 16, days: 7, exercises: 15, sets: 10, name: 80, notes: 300 } as const;
export const MEMBER_AUTHOR = "Built by the member";
export const MEMBER_PREFIX = "member:";

export function memberKey(id: number): string {
  return `${MEMBER_PREFIX}${id}`;
}

export function parseMemberKey(key: string): number | null {
  if (!key.startsWith(MEMBER_PREFIX)) return null;
  const n = Number(key.slice(MEMBER_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A member program repeats; its weeks are shown as a round of about 12 weeks, in whole blocks. */
export function memberLength(weeks: number): number {
  const n = Math.max(1, weeks);
  return n * Math.max(1, Math.ceil(12 / n));
}

/** "3 days a week, one week that repeats", "4 days a week, 6 weeks that repeat". */
export function memberLine(t: Pick<ProgramTemplate, "weeks">): string {
  const days = mostDays(t);
  const weeks = t.weeks.length;
  return `${days} ${days === 1 ? "day" : "days"} a week, ${weeks === 1 ? "one week that repeats" : `${weeks} weeks that repeat`}`;
}

/** The lifts a member program asks a max for: the ones its percent exercises use. */
export function percentLifts(t: Pick<ProgramTemplate, "weeks">): LiftKey[] {
  const used = new Set<LiftKey>();
  for (const w of t.weeks) for (const d of w.days) for (const e of d.exercises) if (e.rule?.kind === "percent" && e.lift) used.add(e.lift);
  return LIFT_KEYS.filter((l) => used.has(l));
}

function cleanExercise(e: ExerciseRx, first: boolean): ExerciseRx {
  const out: ExerciseRx = { name: e.name.trim(), sets: e.sets };
  // A percent exercise takes its max from the lift; a linear one keeps it so a barbell lift never deloads below the empty bar.
  if ((e.rule?.kind === "percent" || e.rule?.kind === "linear") && e.lift) out.lift = e.lift;
  if (e.tier) out.tier = e.tier;
  if (e.bodyweight) out.bodyweight = true;
  if (e.joined && !first) out.joined = true;
  if (e.notes && e.notes.trim()) out.notes = e.notes.trim();
  if (e.rule) out.rule = e.rule;
  return out;
}

/**
 * Everything a member does not choose: the key, the own-rules engine, a max
 * for each percent lift (training max = max), days a week and the length.
 * Only a percent or linear exercise keeps a lift (a max is asked only for a
 * percent one), and the first exercise of a day joins nothing.
 */
export function finishMemberTemplate(t: ProgramTemplate, key: string): ProgramTemplate {
  const weeks = t.weeks.map((w) => ({
    ...(w.label && w.label.trim() ? { label: w.label.trim() } : {}),
    days: w.days.map((d) => ({ name: d.name.trim(), exercises: d.exercises.map((e, i) => cleanExercise(e, i === 0)), ...(d.test ? { test: true } : {}) })),
  }));
  return {
    key,
    name: t.name.trim(),
    author: MEMBER_AUTHOR,
    family: t.family,
    level: t.level,
    daysPerWeek: mostDays({ weeks }),
    lengthWeeks: memberLength(weeks.length),
    lifts: percentLifts({ weeks }),
    tmPct: 1,
    who: "Built by the member.",
    description: t.description,
    engine: { key: "own_rules" },
    weeks,
  };
}

/** One week, one day, no exercises. */
export function blankMemberTemplate(): ProgramTemplate {
  return {
    key: "member:new",
    name: "My program",
    author: MEMBER_AUTHOR,
    family: "strength",
    level: "intermediate",
    daysPerWeek: 1,
    lengthWeeks: memberLength(1),
    lifts: [],
    tmPct: 1,
    who: "Built by the member.",
    description: "A program the member built in the app.",
    engine: { key: "own_rules" },
    weeks: [{ days: [{ name: "Day 1", exercises: [] }] }],
  };
}

const pctText = (p: number) => `${Math.round(p * 1000) / 10}%`;

/** The builder's limits and each rule's set shape, in the words the builder uses. */
export function memberTemplateErrors(t: ProgramTemplate): string[] {
  const errors: string[] = [];
  if (t.weeks.length > MEMBER_LIMITS.weeks) errors.push(`No more than ${MEMBER_LIMITS.weeks} weeks.`);
  t.weeks.forEach((w, wi) => {
    if (w.days.length > MEMBER_LIMITS.days) errors.push(`Week ${wi + 1}: no more than ${MEMBER_LIMITS.days} days.`);
    w.days.forEach((d) => {
      const day = `Week ${wi + 1}, ${d.name}`;
      if (d.exercises.length > MEMBER_LIMITS.exercises) errors.push(`${day}: no more than ${MEMBER_LIMITS.exercises} exercises in a day.`);
      d.exercises.forEach((e, xi) => {
        const where = `${day}, exercise ${xi + 1}`;
        if (e.sets.length > MEMBER_LIMITS.sets) errors.push(`${where}: no more than ${MEMBER_LIMITS.sets} sets in an exercise.`);
        const r = e.rule;
        if (!r) return void errors.push(`${where}: pick a rule.`);
        switch (r.kind) {
          case "linear":
            if (!e.sets.every((s) => s.kind === "fixed" && typeof s.reps === "number")) errors.push(`${where}: every set needs a rep count.`);
            break;
          case "range":
            if (!e.sets.every((s) => s.kind === "fixed" && typeof s.reps !== "number")) errors.push(`${where}: every set needs a rep range.`);
            break;
          case "percent":
            if (!e.lift) errors.push(`${where}: pick the max it uses.`);
            for (const s of e.sets) {
              if (s.kind !== "pct" && s.kind !== "amrap") errors.push(`${where}: every set needs a percentage.`);
              else if (s.pct < 0.3 || s.pct > 1.1) errors.push(`${where}: ${pctText(s.pct)} is outside 30% to 110%.`);
            }
            break;
          case "rpe":
            if (!e.sets.every((s) => s.kind === "rpe")) errors.push(`${where}: every set needs an RPE.`);
            break;
          case "manual":
            if (!e.sets.every((s) => s.kind === "fixed")) errors.push(`${where}: every set needs reps.`);
            break;
          default: {
            const never: never = r;
            return never;
          }
        }
      });
    });
  });
  return [...new Set(errors)].slice(0, 20);
}

/** The whole check for a member program: shape in plain words, the builder's rules, then the library's template rules. */
export function validateMemberTemplate(raw: unknown, key: string): TemplateCheck {
  const parsed = parseTemplate(raw);
  if (!parsed.ok) return parsed;
  const t = finishMemberTemplate(parsed.template, key);
  const mine = memberTemplateErrors(t);
  if (mine.length) return { ok: false, errors: mine };
  const rest = templateErrors(t);
  return rest.length ? { ok: false, errors: rest } : { ok: true, template: t };
}
