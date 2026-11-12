// app/src/lib/programs/memberEdit.ts
/**
 * Editing a member program while it runs: the running state carried onto the
 * new version, and the change-log lines saying what changed. Exercises match
 * old to new by state key (rule + name + rep range). A kept exercise keeps its
 * weight and misses, a new one starts from its rule, a removed one drops out,
 * and a changed rule starts the exercise again. A start weight the member
 * changes sets the working weight from the next session. The member stays on
 * the same day (by name) where it moved; if the current week is removed, they
 * move to the nearest earlier week. Pure.
 */
import { initState } from "./engines";
import { stateKey } from "./planner";
import { LIFT_LABEL, RULE_LABEL, type EngineState, type ExerciseRx, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, roundToStep, trainingMax } from "./units";

export interface EditInput {
  before: ProgramTemplate;
  after: ProgramTemplate;
  state: EngineState;
  /** For each week of `after`, the index of the week of `before` it came from; null for an added week. */
  weekOrigins: (number | null)[];
  stepKg: number;
  unit: WeightUnit;
}

export interface EditOutput {
  state: EngineState;
  /** What changed, one sentence each, for the change log. */
  lines: string[];
}

const clone = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s)) as EngineState;
const sameKg = (a: number, b: number) => Math.abs(a - b) < 0.005;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The week origins the builder sent, or the identity when they do not fit:
 * one entry per new week, each an old week index or null, no old week twice.
 */
export function normaliseOrigins(raw: unknown, beforeWeeks: number, afterWeeks: number): (number | null)[] {
  const identity = Array.from({ length: afterWeeks }, (_, i) => (i < beforeWeeks ? i : null));
  if (!Array.isArray(raw) || raw.length !== afterWeeks) return identity;
  const seen = new Set<number>();
  for (const o of raw) {
    if (o === null) continue;
    if (!Number.isInteger(o) || o < 0 || o >= beforeWeeks || seen.has(o)) return identity;
    seen.add(o);
  }
  return raw as (number | null)[];
}

function exercises(t: ProgramTemplate): ExerciseRx[] {
  return t.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises));
}

function byKey(t: ProgramTemplate): Map<string, ExerciseRx> {
  const m = new Map<string, ExerciseRx>();
  for (const ex of exercises(t)) {
    const k = stateKey(ex);
    if (!m.has(k)) m.set(k, ex);
  }
  return m;
}

function startOf(ex: ExerciseRx | undefined): number | undefined {
  const r = ex?.rule;
  if (!r || (r.kind !== "linear" && r.kind !== "range" && r.kind !== "manual")) return undefined;
  return r.startKg !== undefined && r.startKg > 0 ? r.startKg : undefined;
}

/** Names in `a` that are not in `b`, first spelling kept, in order. */
function missingFrom(a: string[], b: string[]): string[] {
  const inB = new Set(b.map(norm));
  const out = new Map<string, string>();
  for (const n of a) if (!inB.has(norm(n)) && !out.has(norm(n))) out.set(norm(n), n.trim());
  return [...out.values()];
}

const list = (xs: string[]) => xs.join(", ");

export function rebaseEdit(input: EditInput): EditOutput {
  const { before, after, state, stepKg } = input;
  const fmt = (kg: number) => formatWeight(kg, input.unit);
  const lines: string[] = [];
  const next = clone(state);
  const oldKeys = byKey(before);
  const newKeys = byKey(after);
  const fresh = initState(after, state.maxes, stepKg);

  // ── what changed: weeks, days, exercises, rules ──
  if (before.weeks.length !== after.weeks.length) lines.push(`Weeks: ${before.weeks.length} to ${after.weeks.length}.`);
  const dayNames = (t: ProgramTemplate) => t.weeks.flatMap((w) => w.days.map((d) => d.name));
  const addedDays = missingFrom(dayNames(after), dayNames(before));
  const removedDays = missingFrom(dayNames(before), dayNames(after));
  if (addedDays.length) lines.push(`Added days: ${list(addedDays)}.`);
  if (removedDays.length) lines.push(`Removed days: ${list(removedDays)}.`);
  const exNames = (t: ProgramTemplate) => exercises(t).map((e) => e.name);
  const addedEx = missingFrom(exNames(after), exNames(before));
  const removedEx = missingFrom(exNames(before), exNames(after));
  if (addedEx.length) lines.push(`Added exercises: ${list(addedEx)}.`);
  if (removedEx.length) lines.push(`Removed exercises: ${list(removedEx)}.`);
  const keptNames = new Set(exNames(after).map(norm).filter((n) => exNames(before).some((b) => norm(b) === n)));
  for (const name of keptNames) {
    const oldK = [...oldKeys.entries()].filter(([, e]) => norm(e.name) === name);
    const newK = [...newKeys.entries()].filter(([, e]) => norm(e.name) === name);
    const gone = oldK.filter(([k]) => !newKeys.has(k));
    const came = newK.filter(([k]) => !oldKeys.has(k));
    if (gone.length === 0 || came.length === 0) continue;
    const oldKinds = new Set(gone.map(([, e]) => e.rule?.kind));
    const newKind = came.map(([, e]) => e.rule?.kind).find((k) => k && !oldKinds.has(k));
    const label = came[0][1].name.trim();
    lines.push(newKind ? `${label} now uses ${RULE_LABEL[newKind].toLowerCase()}. It starts again from the new rule.` : `${label} has a new rep range. It starts again from there.`);
  }

  // ── weights and misses, by state key ──
  for (const k of Object.keys(next.weights)) if (!newKeys.has(k)) delete next.weights[k];
  for (const k of Object.keys(next.misses)) if (!newKeys.has(k)) delete next.misses[k];
  for (const k of Object.keys(next.stages)) if (!newKeys.has(k)) delete next.stages[k];
  for (const [k, ex] of newKeys) {
    if (!oldKeys.has(k)) {
      delete next.misses[k];
      if (fresh.weights[k] !== undefined) next.weights[k] = fresh.weights[k];
      else delete next.weights[k];
      continue;
    }
    const start = startOf(ex);
    if (start === undefined) continue;
    // Only a start weight the member changed in this edit moves the working weight.
    const was = startOf(oldKeys.get(k));
    const want = roundToStep(start, stepKg);
    if (was !== undefined && sameKg(roundToStep(was, stepKg), want)) continue;
    next.weights[k] = want;
    next.misses[k] = 0;
    lines.push(`${ex.name.trim()}: ${fmt(want)} from the next session.`);
  }

  // ── maxes: training max = max; a new percent lift needs a max ──
  for (const lift of after.lifts) {
    const max = next.maxes[lift];
    if (max !== undefined) next.tms[lift] = trainingMax(max, after.tmPct);
    else lines.push(`Add your ${LIFT_LABEL[lift].toLowerCase()} max on My program to get its weights.`);
  }

  // ── position: the same week where it moved to, else the nearest earlier one ──
  const origins = normaliseOrigins(input.weekOrigins, before.weeks.length, after.weeks.length);
  const at = origins.indexOf(state.week);
  if (at >= 0) {
    // The same day by name if it is still in the week, else the same place, clamped.
    const name = before.weeks[state.week]?.days[state.day]?.name;
    const byName = name === undefined ? -1 : after.weeks[at].days.findIndex((d) => norm(d.name) === norm(name));
    next.week = at;
    next.day = byName >= 0 ? byName : Math.min(state.day, after.weeks[at].days.length - 1);
  } else {
    let best = -1;
    let to = 0;
    origins.forEach((o, i) => {
      if (o !== null && o < state.week && o > best) {
        best = o;
        to = i;
      }
    });
    next.week = to;
    next.day = 0;
    lines.push(`Week ${state.week + 1} was removed, so you're on week ${to + 1} now.`);
  }
  next.finished = false;

  if (lines.length === 0) lines.push("Sets, reps or notes changed.");
  return { state: next, lines };
}

/** The change-log entry for an edit. */
export function editReason(lines: string[]): string {
  return ["You edited the program.", ...lines].join("\n");
}
