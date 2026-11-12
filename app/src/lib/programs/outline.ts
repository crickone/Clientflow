// app/src/lib/programs/outline.ts
/**
 * The program page's outline: session length, a typical week, every week as
 * prescribed, the first week with a member's real weights, and the line on
 * why a planned weight is what it is. Pure: safe in client components.
 */
import { initState } from "./engines";
import { planExercise, setsFor, summarisePlanned, summariseRx, type PlanContext } from "./planner";
import { LIFT_LABEL, type DayRx, type ExerciseRx, type LiftKey, type PlannedExercise, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight } from "./units";
import { WEEKDAY_SHORT, addDays, isoWeekday } from "@/lib/trainingProgress";

/** The time a set takes, before its rest. */
export const SECONDS_PER_SET = 40;

/** One day's estimated seconds: every set's 40 s plus its rest, at each exercise's first rep scheme. */
export function daySeconds(d: DayRx): number {
  return d.exercises.reduce((n, ex) => n + setsFor(ex, {}).reduce((m, s) => m + SECONDS_PER_SET + s.rest, 0), 0);
}

/** The average session across every day of the program, to the nearest 5 minutes (at least 5). */
export function sessionMinutes(t: Pick<ProgramTemplate, "weeks">): number {
  const days = t.weeks.flatMap((w) => w.days);
  if (days.length === 0) return 5;
  const avg = days.reduce((n, d) => n + daySeconds(d), 0) / days.length / 60;
  return Math.max(5, Math.round(avg / 5) * 5);
}

export interface OutlineLine {
  name: string;
  rx: string;
  joined: boolean;
  notes: string | null;
}

export interface OutlineDay {
  name: string;
  test: boolean;
  lines: OutlineLine[];
}

export interface OutlineWeek {
  title: string;
  days: OutlineDay[];
}

function outlineDay(d: DayRx): OutlineDay {
  return {
    name: d.name,
    test: d.test === true,
    lines: d.exercises.map((ex) => ({ name: ex.name, rx: summariseRx(setsFor(ex, {})), joined: ex.joined === true, notes: ex.notes ?? null })),
  };
}

/** Every week as prescribed: "Week 2: Base, plus 10 kg", its days, and each exercise's sets. */
export function wholeProgram(t: Pick<ProgramTemplate, "weeks">): OutlineWeek[] {
  return t.weeks.map((w, i) => ({ title: w.label ? `Week ${i + 1}: ${w.label}` : `Week ${i + 1}`, days: w.days.map(outlineDay) }));
}

/** The first week of the cycle, day by day. */
export function typicalWeek(t: Pick<ProgramTemplate, "weeks">): OutlineDay[] {
  return (t.weeks[0]?.days ?? []).map(outlineDay);
}

/** The pill on a card: the one lift a program is about, how many lifts it takes a max for, or rep ranges. */
export function focusTag(t: Pick<ProgramTemplate, "lifts">): string {
  if (t.lifts.length === 1) return LIFT_LABEL[t.lifts[0]];
  if (t.lifts.length > 1) return `${t.lifts.length} lifts`;
  return "Rep ranges";
}

/** "12 weeks", "Repeats weekly", "Repeats every 4 weeks". */
export function lengthTag(t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, repeats: boolean): string {
  if (!repeats) return `${t.lengthWeeks} ${t.lengthWeeks === 1 ? "week" : "weeks"}`;
  return t.weeks.length === 1 ? "Repeats weekly" : `Repeats every ${t.weeks.length} weeks`;
}

export interface PreviewDay {
  name: string;
  test: boolean;
  lines: string[];
}

/** What the app plans from a member's logs (planContextFor in enrolments.ts): best estimated maxes for RPE sets, last weights for member-built exercises. */
export type PlanExtra = Pick<PlanContext, "e1rm" | "lastKg">;

/** Week 1 with the member's weights: "Back squat 4 x 9 at 97.5 kg". Unweighted exercises say why. Pass `extra` so it plans what the app will. */
export function firstWeek(t: ProgramTemplate, maxesKg: Partial<Record<LiftKey, number>>, stepKg: number, unit: WeightUnit, extra?: PlanExtra): PreviewDay[] {
  const state = initState(t, maxesKg, stepKg);
  return (t.weeks[0]?.days ?? []).map((d, di) => ({
    name: d.name,
    test: d.test === true,
    lines: d.exercises.map((ex, xi) => {
      const p = planExercise(ex, xi, { ...state, week: 0, day: di }, { ...extra, stepKg });
      if (p.bodyweight) return `${ex.name} ${summarisePlanned(p.sets, unit)}, bodyweight`;
      if (p.sets.every((s) => s.kg === null)) return `${ex.name} ${summarisePlanned(p.sets, unit)}, you pick the weight`;
      return `${ex.name} ${summarisePlanned(p.sets, unit)}`;
    }),
  }));
}

/** The first sets of a lift from one max: "4 x 9 at 97.5 kg". Null when no weighted exercise in week 1 uses it. */
export function firstSets(t: ProgramTemplate, lift: LiftKey, maxKg: number, stepKg: number, unit: WeightUnit, extra?: PlanExtra): string | null {
  const state = initState(t, { [lift]: maxKg }, stepKg);
  const days = t.weeks[0]?.days ?? [];
  for (let di = 0; di < days.length; di++) {
    const xi = days[di].exercises.findIndex((ex) => ex.lift === lift && !ex.bodyweight);
    if (xi === -1) continue;
    const p = planExercise(days[di].exercises[xi], xi, { ...state, week: 0, day: di }, { ...extra, stepKg });
    if (p.sets.every((s) => s.kg === null)) continue;
    return summarisePlanned(p.sets, unit);
  }
  return null;
}

/** The next n training dates on or after the start date, on the member's weekdays (1 = Monday). Empty with no weekdays. */
export function trainingDates(startDate: string, weekdays: number[], n: number): string[] {
  if (weekdays.length === 0 || n <= 0) return [];
  const out: string[] = [];
  for (let i = 0; out.length < n && i < 7 * (n + 1); i++) {
    const d = addDays(startDate, i);
    if (weekdays.includes(isoWeekday(d))) out.push(d);
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 16 Nov" for a date key, the same on the server and the phone. */
export function shortDate(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${WEEKDAY_SHORT[isoWeekday(key) - 1]} ${d} ${MONTHS[m - 1]}`;
}

const pctText = (p: number) => `${Math.round(p * 1000) / 10}%`;

/**
 * Why a planned weight is what it is: "75% of your max, plus 10 kg this week",
 * from the planned sets and the template exercise they came from. Null for a
 * weight the engine keeps from session to session.
 */
export function weightWhy(ex: PlannedExercise, rx: Pick<ExerciseRx, "sets"> | undefined, tmPct: number, unit: WeightUnit): string | null {
  if (ex.bodyweight) return "Bodyweight.";
  const pcts = [...new Set(ex.sets.flatMap((s) => (s.pct !== null ? [s.pct] : [])))].sort((a, b) => a - b);
  if (pcts.length) {
    const of = tmPct === 1 ? "your max" : "your training max";
    const range = pcts.length === 1 ? pctText(pcts[0]) : `${pctText(pcts[0])} to ${pctText(pcts[pcts.length - 1])}`;
    const add = Math.max(0, ...(rx?.sets ?? []).map((s) => (s.kind === "pct" || s.kind === "amrap" ? (s.addKg ?? 0) : 0)));
    return `${range} of ${of}${add > 0 ? `, plus ${formatWeight(add, unit)} this week` : ""}.`;
  }
  const rpes = [...new Set(ex.sets.flatMap((s) => (s.rpe !== null ? [s.rpe] : [])))].sort((a, b) => a - b);
  if (rpes.length) return `Worked out for RPE ${rpes.join(" and ")} from your best logged set.`;
  return null;
}
