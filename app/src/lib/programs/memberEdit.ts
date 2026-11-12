// app/src/lib/programs/memberEdit.ts
/**
 * Editing a member program while it runs: the running state carried onto the
 * new version, and the change-log lines saying what changed. Exercises match
 * old to new by state key (rule + name + rep range). A kept exercise keeps its
 * weight and misses, a new one starts from its rule, a removed one drops out,
 * and a changed rule starts the exercise again. A start weight the member
 * changes sets the working weight from the next session. The member stays on
 * the same day (by name) where it moved; if the current week is removed, they
 * move to the nearest earlier week, or the first one if there is none. Pure.
 *
 * An edit that changes nothing (same weeks, same order) returns the state
 * untouched and `lines: []`. CALLERS MUST SKIP the change-log event when
 * `lines` is empty.
 */
import { initState, ownStartWeight } from "./engines";
import { stateKey } from "./planner";
import { LIFT_LABEL, type EngineState, type ExerciseRx, type ProgramTemplate, type RuleKind, type WeightUnit } from "./types";
import { formatWeight, trainingMax } from "./units";

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
 * The week origins the builder sent, or a fallback when they are missing or do
 * not fit: one entry per new week, each an old week index or null, no old week
 * twice. Missing origins mean "same index" when the week count is unchanged.
 * When the count changed and the weeks are given, the member's week is found
 * by identical content; with no identical week it is the same index, which
 * the caller clamps.
 */
export function normaliseOrigins(
  raw: unknown,
  beforeWeeks: number,
  afterWeeks: number,
  weeks?: { before: ProgramTemplate["weeks"]; after: ProgramTemplate["weeks"]; current: number },
): (number | null)[] {
  const identity = Array.from({ length: afterWeeks }, (_, i) => (i < beforeWeeks ? i : null));
  if (!Array.isArray(raw)) {
    if (weeks && beforeWeeks !== afterWeeks && weeks.before[weeks.current]) {
      const mine = JSON.stringify(weeks.before[weeks.current]);
      const at = weeks.after.findIndex((w) => JSON.stringify(w) === mine);
      if (at >= 0) return weeks.after.map((_, i) => (i === at ? weeks.current : null));
    }
    return identity;
  }
  if (raw.length !== afterWeeks) return identity;
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

/** The start weight rounded to the step; 0 when it is set but rounds to nothing; undefined when not set. */
function startOf(ex: ExerciseRx | undefined, stepKg: number): number | undefined {
  const r = ex?.rule;
  if (!r || (r.kind !== "linear" && r.kind !== "range" && r.kind !== "manual")) return undefined;
  if (r.startKg === undefined || !(r.startKg > 0)) return undefined;
  return ownStartWeight(ex, stepKg) ?? 0;
}

const RULE_PHRASE: Record<RuleKind, string> = {
  linear: "adds weight each session",
  range: "goes up through a rep range",
  percent: "uses a percent of your max",
  rpe: "goes by RPE",
  manual: "uses weights you set yourself",
};

const RULE_NOUN: Record<RuleKind, string> = {
  linear: "weight added each session",
  range: "rep range",
  percent: "percent of your max",
  rpe: "RPE",
  manual: "weights you set yourself",
};

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
  const origins = normaliseOrigins(input.weekOrigins, before.weeks.length, after.weeks.length, {
    before: before.weeks,
    after: after.weeks,
    current: state.week,
  });

  // ── nothing changed: same weeks, same order ──
  const inOrder = origins.every((o, i) => o === i);
  if (inOrder && JSON.stringify(before.weeks) === JSON.stringify(after.weeks)) return { state: next, lines: [] };

  // ── what changed: weeks, days, exercises, rules ──
  if (before.weeks.length !== after.weeks.length) lines.push(`Weeks: ${before.weeks.length} to ${after.weeks.length}.`);
  const kept = origins.filter((o): o is number => o !== null);
  if (kept.some((o, i) => i > 0 && o < kept[i - 1])) lines.push("Weeks reordered.");
  const dayNames = (t: ProgramTemplate) => t.weeks.flatMap((w) => w.days.map((d) => d.name));
  const addedDays = missingFrom(dayNames(after), dayNames(before));
  const removedDays = missingFrom(dayNames(before), dayNames(after));
  if (addedDays.length) lines.push(`Added days: ${list(addedDays)}.`);
  if (removedDays.length) lines.push(`Removed days: ${list(removedDays)}.`);
  // A day added to or removed from one week only (the name still exists elsewhere).
  const globalDays = new Set([...addedDays, ...removedDays].map(norm));
  origins.forEach((o, i) => {
    if (o === null) return;
    const was = before.weeks[o].days.map((d) => d.name);
    const now = after.weeks[i].days.map((d) => d.name);
    const gone = missingFrom(was, now).filter((n) => !globalDays.has(norm(n)));
    const came = missingFrom(now, was).filter((n) => !globalDays.has(norm(n)));
    if (gone.length) lines.push(`Week ${i + 1}: removed ${list(gone)}.`);
    if (came.length) lines.push(`Week ${i + 1}: added ${list(came)}.`);
  });
  const exNames = (t: ProgramTemplate) => exercises(t).map((e) => e.name);
  const addedEx = missingFrom(exNames(after), exNames(before));
  const removedEx = missingFrom(exNames(before), exNames(after));
  if (addedEx.length) lines.push(`Added exercises: ${list(addedEx)}.`);
  if (removedEx.length) lines.push(`Removed exercises: ${list(removedEx)}.`);
  const keptNames = new Set(exNames(after).map(norm).filter((n) => exNames(before).some((b) => norm(b) === n)));
  const withRule = (e: ExerciseRx) => (e.rule ? ` (${RULE_NOUN[e.rule.kind]})` : "");
  for (const name of keptNames) {
    const oldK = [...oldKeys.entries()].filter(([, e]) => norm(e.name) === name);
    const newK = [...newKeys.entries()].filter(([, e]) => norm(e.name) === name);
    const gone = oldK.filter(([k]) => !newKeys.has(k));
    const came = newK.filter(([k]) => !oldKeys.has(k));
    if (gone.length > 0 && came.length === 0) {
      for (const [, e] of gone) lines.push(`Removed: ${e.name.trim()}${withRule(e)}.`);
      continue;
    }
    if (came.length > 0 && gone.length === 0) {
      for (const [, e] of came) lines.push(`Added: ${e.name.trim()}${withRule(e)}.`);
      continue;
    }
    if (gone.length === 0 || came.length === 0) continue;
    const oldKinds = new Set(gone.map(([, e]) => e.rule?.kind));
    const newKind = came.map(([, e]) => e.rule?.kind).find((k) => k && !oldKinds.has(k));
    const label = came[0][1].name.trim();
    lines.push(newKind ? `${label} now ${RULE_PHRASE[newKind]}. It starts again from the new rule.` : `${label} has a new rep range. It starts again from there.`);
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
    const want = startOf(ex, stepKg);
    if (want === undefined) continue;
    // Only a start weight the member changed in this edit moves the working weight.
    const was = startOf(oldKeys.get(k), stepKg);
    if (was !== undefined && sameKg(was, want)) continue;
    next.misses[k] = 0;
    if (want > 0) {
      next.weights[k] = want;
      lines.push(`${ex.name.trim()}: ${fmt(want)} from the next session.`);
    } else delete next.weights[k];
  }

  // ── maxes: training max = max; a lift new to the program needs a max ──
  for (const lift of after.lifts) {
    const max = next.maxes[lift];
    if (max !== undefined) next.tms[lift] = trainingMax(max, after.tmPct);
    else if (!before.lifts.includes(lift)) lines.push(`Add your ${LIFT_LABEL[lift].toLowerCase()} max on My program to get its weights.`);
  }

  // ── position: the same week where it moved to, else the nearest earlier one ──
  const at = origins.indexOf(state.week);
  if (at >= 0) {
    // The same day if it is still there, else the first day of that name, else the same place, clamped.
    const days = after.weeks[at].days;
    const name = before.weeks[state.week]?.days[state.day]?.name;
    let day: number;
    if (name !== undefined && days[state.day] && norm(days[state.day].name) === norm(name)) day = state.day;
    else {
      const byName = name === undefined ? -1 : days.findIndex((d) => norm(d.name) === norm(name));
      day = byName >= 0 ? byName : Math.min(state.day, days.length - 1);
    }
    next.week = at;
    next.day = Math.max(0, day);
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
    lines.push(`The week you were on was removed, so you're now on week ${to + 1}.`);
  }
  next.finished = false;

  if (lines.length === 0) lines.push("Sets, reps or notes changed.");
  if (lines.length > 8) {
    const more = lines.length - 8;
    lines.length = 8;
    lines.push(`and ${more} more change${more === 1 ? "" : "s"}.`);
  }
  return { state: next, lines };
}

/** The change-log entry for an edit. */
export function editReason(lines: string[]): string {
  return ["You edited the program.", ...lines].join("\n");
}
