// app/src/lib/programs/progressionText.ts
/**
 * "How your weights move", built from the engine settings and the exercise
 * rules, so it always says what the app does. Weights are in the member's
 * unit; a jump the engine rounds to the member's smallest jump is shown
 * rounded. Pure.
 */
import { listText, weeksText } from "./content";
import { barKg } from "./engines";
import { progresses, schemeLabel } from "./planner";
import { LIFT_LABEL, OWN_DELOAD_PCT, type ExerciseRx, type LiftKey, type ProgramTemplate, type SetRx, type WeightUnit } from "./types";
import { formatWeight, roundToStep } from "./units";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pctText = (p: number) => `${Math.round(p * 1000) / 10}%`;
const allSets = (ex: ExerciseRx): SetRx[] => [...ex.sets, ...(ex.stages ?? []).flat()];
const exercises = (t: Pick<ProgramTemplate, "weeks">): ExerciseRx[] => t.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises));
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/** A weight jump after rounding to the member's smallest jump; null when it rounds to nothing. */
function stepJump(incKg: number, unit: WeightUnit, stepKg: number): string | null {
  const j = roundToStep(incKg, stepKg);
  return j > 0 ? formatWeight(j, unit) : null;
}

/** "2.5 kg", or "2.5 kg, or 5 kg on the deadlift": one jump per group of lifts, the default first. */
function jumpsByLift(lifts: LiftKey[], base: number, per: Partial<Record<LiftKey, number>> | undefined, show: (kg: number) => string | null): string | null {
  const groups = new Map<string, LiftKey[]>();
  const baseText = show(base);
  for (const lift of lifts) {
    const text = show(per?.[lift] ?? base);
    if (text === null) continue;
    groups.set(text, [...(groups.get(text) ?? []), lift]);
  }
  if (groups.size === 0) return null;
  const first = baseText !== null && groups.has(baseText) ? baseText : [...groups.keys()][0];
  const rest = [...groups.entries()].filter(([text]) => text !== first);
  if (rest.length === 0) return first;
  return `${first}, or ${rest.map(([text, ls]) => `${text} on the ${listText(ls.map((l) => LIFT_LABEL[l].toLowerCase()))}`).join(", or ")}`;
}

/** The lifts whose weights the engine moves, in the program's order. */
function movingLifts(t: ProgramTemplate): LiftKey[] {
  const used = new Set(exercises(t).filter((ex) => ex.lift && (progresses(ex) || allSets(ex).some((s) => s.kind === "pct" || s.kind === "amrap"))).map((ex) => ex.lift as LiftKey));
  return t.lifts.filter((l) => used.has(l));
}

/** Lines for exercises the program does not move: bodyweight ones, and fixed-weight ones it leaves alone. */
function leftAlone(t: ProgramTemplate): string[] {
  const all = exercises(t);
  const bw = unique(all.filter((ex) => ex.bodyweight).map((ex) => ex.name.toLowerCase()));
  const block = t.engine.key === "fixed_block";
  // A name that progresses somewhere else (PHAT's speed sets) is left out, so the line never contradicts the rest.
  const moving = new Set(block ? [] : all.filter((ex) => progresses(ex)).map((ex) => ex.name.toLowerCase()));
  const picked = unique(
    all
      .filter((ex) => !ex.bodyweight && ex.sets.every((s) => s.kind === "fixed" || s.kind === "same_as_last") && (block || !progresses(ex)))
      .map((ex) => ex.name.toLowerCase())
      .filter((n) => !moving.has(n)),
  );
  const out: string[] = [];
  if (picked.length) out.push(`You pick the weight for ${listText(picked)}. The program does not change it.`);
  if (bw.length) out.push(`${cap(listText(bw))} ${bw.length === 1 ? "is" : "are"} bodyweight. Add reps when you can.`);
  return out;
}

/** "Miss reps three sessions in a row and that lift drops 10%." */
function deloadLine(after: number, pct: number): string {
  const p = Math.round(pct * 100);
  return after <= 1 ? `Fall short on any set and that lift drops ${p}% next time.` : `Miss reps ${word(after)} sessions in a row and that lift drops ${p}%.`;
}

function startLine(t: ProgramTemplate, startPct: number): string {
  return `Each lift starts at ${pctText(startPct)} of your ${t.tmPct === 1 ? "max" : "training max"}.`;
}

/** One sentence on how a member-built exercise moves, for the builder sheet and the program page. */
export function ruleSentence(ex: ExerciseRx, unit: WeightUnit, stepKg: number): string {
  const r = ex.rule;
  const name = ex.name.trim() || "This exercise";
  const n = ex.sets.length;
  if (!r) return `${name} follows the program.`;
  // The planner plans no weight for a bodyweight exercise and the engine keeps none, whatever its rule.
  if (ex.bodyweight) return `${name} uses your bodyweight. Add reps when you can.`;
  switch (r.kind) {
    case "linear": {
      const jump = stepJump(r.incKg, unit, stepKg);
      const misses = r.deloadAfter <= 1 ? "a miss" : `${word(r.deloadAfter)} misses in a row`;
      const drop = `${Math.round(OWN_DELOAD_PCT * 100)}%`;
      if (jump === null) return `${name} adds ${formatWeight(r.incKg, unit)}, less than your smallest jump, so it only changes when it drops ${drop} after ${misses}.`;
      return `${name} goes up ${jump} after a session with every rep, and drops ${drop} after ${misses}.`;
    }
    case "range": {
      const inc = r.incKg ?? stepKg;
      const jump = stepJump(inc, unit, stepKg);
      if (jump === null) return `${name} adds ${formatWeight(inc, unit)}, less than your smallest jump, so its weight stays the same.`;
      const tops = unique(ex.sets.map((s) => (s.kind === "fixed" && typeof s.reps !== "number" ? s.reps.max : null)));
      const bottoms = unique(ex.sets.map((s) => (s.kind === "fixed" ? (typeof s.reps === "number" ? s.reps : s.reps.min) : null)));
      const when = tops.length === 1 && tops[0] !== null ? (n === 1 ? `your set reaches ${tops[0]} reps` : `all ${n} sets reach ${tops[0]} reps`) : "every set reaches the top of its range";
      const back = bottoms.length === 1 && bottoms[0] !== null ? `the reps go back to ${bottoms[0]}` : "the reps go back to the bottom";
      return `${name} goes up ${jump} once ${when}, then ${back}.`;
    }
    case "percent": {
      const pcts = unique(ex.sets.flatMap((s) => (s.kind === "pct" || s.kind === "amrap" ? [s.pct] : []))).sort((a, b) => a - b);
      const range = pcts.length === 0 ? "a percentage" : pcts.length === 1 ? pctText(pcts[0]) : `${pctText(pcts[0])} to ${pctText(pcts[pcts.length - 1])}`;
      const lift = ex.lift ? LIFT_LABEL[ex.lift].toLowerCase() : "lift";
      return `${name} is ${range} of your ${lift} max. It moves when you change the max.`;
    }
    case "rpe": {
      const rpes = unique(ex.sets.flatMap((s) => (s.kind === "rpe" ? [s.rpe] : []))).sort((a, b) => a - b);
      const at = rpes.length <= 1 ? `RPE ${rpes[0] ?? 8}` : `RPE ${rpes[0]} to ${rpes[rpes.length - 1]}`;
      return `${name} is worked out for ${at} from your best logged set.`;
    }
    case "manual":
      return `${name} stays at the weight you choose.`;
    default: {
      const never: never = r;
      return never;
    }
  }
}

/**
 * "Ten or more reps on the last set doubles the jump on the squat and deadlift."
 * Only the lifts whose doubled jump lands on a different weight at the member's
 * step (and that end on a + set); null when none does.
 */
function doubleLine(t: ProgramTemplate, e: Extract<ProgramTemplate["engine"], { key: "linear" }>, stepKg: number): string | null {
  if (e.doubleAt === undefined) return null;
  const moving = movingLifts(t);
  const plusLifts = new Set(exercises(t).filter((ex) => ex.lift && progresses(ex) && allSets(ex).some((s) => s.kind === "fixed" && s.amrap)).map((ex) => ex.lift as LiftKey));
  const base = roundToStep(60, stepKg);
  const doubled = moving.filter((l) => {
    const inc = e.increments?.[l] ?? e.increment;
    return plusLifts.has(l) && Math.abs(roundToStep(base + 2 * inc, stepKg) - roundToStep(base + inc, stepKg)) > 0.005;
  });
  if (doubled.length === 0) return null;
  const on = doubled.length === moving.length ? "" : ` on the ${listText(doubled.map((l) => LIFT_LABEL[l].toLowerCase()))}`;
  return `${cap(word(e.doubleAt))} or more reps on the last set doubles the jump${on}.`;
}

function linearLines(t: ProgramTemplate, e: Extract<ProgramTemplate["engine"], { key: "linear" }>, unit: WeightUnit, stepKg: number): string[] {
  const lines = [startLine(t, e.startPct)];
  const jumps = jumpsByLift(movingLifts(t), e.increment, e.increments, (kg) => stepJump(kg, unit, stepKg));
  if (jumps) lines.push(`Get every rep on every set and the weight goes up next time: ${jumps}.`);
  if (e.doubleAt !== undefined) {
    const line = doubleLine(t, e, stepKg);
    if (line) lines.push(line);
  }
  lines.push(deloadLine(e.deloadAfter, e.deloadPct));
  lines.push(`A lift never drops below the empty bar (${formatWeight(barKg(stepKg), unit)}).`);
  return lines;
}

function tmLines(t: ProgramTemplate, e: Extract<ProgramTemplate["engine"], { key: "tm_cycle" }>, unit: WeightUnit, stepKg: number): string[] {
  const lines: string[] = [];
  const raw = (kg: number) => (kg > 0 ? formatWeight(kg, unit) : null);
  const driveReps = unique(exercises(t).flatMap((ex) => ex.sets.flatMap((s) => ((s.kind === "pct" || s.kind === "amrap") && s.drives ? [s.reps] : []))));
  // Texas Method: a training max of 6/7 of the max is the Epley 5-rep max.
  const repMax = e.rule === "drive_set" && driveReps.length === 1 && Math.abs(t.tmPct - 30 / (30 + driveReps[0])) < 0.005 ? driveReps[0] : null;
  if (repMax !== null) lines.push(`Your training max is your ${repMax}-rep max, about ${Math.round(t.tmPct * 100)}% of your max. Every percentage is taken from it.`);
  else if (t.tmPct !== 1) lines.push(`Your training max is ${Math.round(t.tmPct * 100)}% of your max. Every percentage is taken from it.`);
  switch (e.rule) {
    case "cycle": {
      const jumps = jumpsByLift(t.lifts, e.increment, e.increments, raw);
      const plusWeeks = t.weeks.flatMap((w, i) => (w.days.some((d) => d.exercises.some((ex) => ex.sets.some((s) => s.kind === "amrap"))) ? [i + 1] : []));
      if (plusWeeks.length) {
        const contiguous = plusWeeks[plusWeeks.length - 1] - plusWeeks[0] === plusWeeks.length - 1;
        const when = plusWeeks.length === t.weeks.length ? "" : contiguous ? ` in ${weeksText(plusWeeks[0], plusWeeks[plusWeeks.length - 1]).toLowerCase()}` : ` in weeks ${listText(plusWeeks.map(String))}`;
        lines.push(`The last set of each main lift${when} is as many reps as you can.`);
      }
      if (jumps) lines.push(`After each ${word(t.weeks.length)}-week cycle, your training max goes up ${jumps}.`);
      // The engine marks a lift short only from a finished session; a skipped one runs nothing but the end of the cycle.
      lines.push(
        "If you finish a session and its + set falls short, isn't ticked, or is lighter than planned, that lift's training max stays the same for the next cycle. Skipped sessions don't hold it back.",
      );
      break;
    }
    case "amrap_table": {
      const rows = [...(e.amrapTable ?? [])].sort((a, b) => a.minReps - b.minReps);
      const parts = rows.map((row, i) => {
        const next = rows[i + 1];
        const reps = next ? (next.minReps - 1 === row.minReps ? `${row.minReps}` : `${row.minReps} to ${next.minReps - 1}`) : `${row.minReps} or more`;
        return row.kg > 0 ? `${reps} reps adds ${formatWeight(row.kg, unit)}` : `${reps} reps changes nothing`;
      });
      if (parts.length) lines.push(`The reps on the heavy + set move your training max: ${listText(parts)}.`);
      lines.push("If the + set isn't ticked or is lighter than planned, the training max stays the same.");
      break;
    }
    case "drive_set": {
      const jumps = jumpsByLift(t.lifts, e.increment, e.increments, raw);
      const top = driveReps.length === 1 ? `all ${driveReps[0]} reps` : "every rep";
      if (jumps) lines.push(`Get ${top} on a top set and that lift's training max goes up ${jumps}.`);
      lines.push("If the top set falls short, isn't ticked, or is lighter than planned, the training max stays the same.");
      break;
    }
    case "gzclp": {
      const all = exercises(t);
      const tier = (k: "t1" | "t2" | "t3") => all.find((ex) => ex.tier === k);
      const t1 = tier("t1");
      const t2 = tier("t2");
      const t3 = tier("t3");
      const schemes = (ex: ExerciseRx | undefined) => (ex?.stages ?? []).map(schemeLabel);
      const jumps = jumpsByLift(t.lifts, e.increment, e.increments, (kg) => stepJump(kg, unit, stepKg));
      if (t1?.startPct && t2?.startPct) lines.push(`Main lifts (T1) start at ${pctText(t1.startPct)} of your max and second lifts (T2) at ${pctText(t2.startPct)}.`);
      if (jumps) lines.push(`Hit every rep and the lift goes up next time: ${jumps}.`);
      const s1 = schemes(t1);
      if (s1.length >= 2) lines.push(`Miss on a main lift and it moves on to ${s1.slice(1).join(", then ")} at the same weight. Miss on ${s1[s1.length - 1]} and it goes back to ${s1[0]} at 85% of that weight.`);
      const s2 = schemes(t2);
      const reset = stepJump(e.t2ResetKg ?? 5, unit, stepKg);
      if (s2.length >= 2 && reset) lines.push(`Miss on a second lift and it moves on to ${s2.slice(1).join(", then ")}. Miss on ${s2[s2.length - 1]} and it goes back to ${s2[0]}, ${reset} heavier than it last started.`);
      if (t3) lines.push(`Accessories (T3) go up ${formatWeight(stepKg, unit)} once the last set reaches ${e.t3AmrapTarget ?? 25} reps.`);
      break;
    }
  }
  return lines;
}

/** An add-on as the member sees it: "10 kg", or "about 20 lb" when it is not a whole number of their jumps. */
function addText(kg: number, unit: WeightUnit, stepKg: number): string {
  const r = roundToStep(kg, stepKg);
  return Math.abs(r - kg) < 0.005 || r <= 0 ? formatWeight(kg, unit) : `about ${formatWeight(r, unit)}`;
}

function blockLines(t: ProgramTemplate, unit: WeightUnit, stepKg: number): string[] {
  const lines = [`Every weight is a percentage of the ${t.tmPct === 1 ? "max" : "training max"} you enter.`];
  const addOf = (s: SetRx) => (s.kind === "pct" || s.kind === "amrap" ? (s.addKg ?? 0) : 0);
  const adds = t.weeks
    .map((w, i) => ({ week: i + 1, kg: Math.max(0, ...w.days.flatMap((d) => d.exercises.flatMap((ex) => ex.sets.map(addOf)))) }))
    .filter((a) => a.kg > 0);
  if (adds.length) lines.push(`${cap(listText(adds.map((a) => `week ${a.week} adds ${addText(a.kg, unit, stepKg)}`)))} to every set.`);
  lines.push("The weights are set from the start. They do not change with how a session goes.");
  if (t.weeks.some((w) => w.days.some((d) => d.test))) lines.push("The test day reads your new max from your best set. Start the block again from it.");
  return lines;
}

/** "How your weights move": plain sentences for the program page. */
export function howWeightsMove(t: ProgramTemplate, unit: WeightUnit, stepKg: number): string[] {
  const e = t.engine;
  switch (e.key) {
    case "linear":
      return [...linearLines(t, e, unit, stepKg), ...leftAlone(t)];
    case "tm_cycle":
      return [...tmLines(t, e, unit, stepKg), ...leftAlone(t)];
    case "fixed_block":
      return [...blockLines(t, unit, stepKg), ...leftAlone(t)];
    case "double_progression":
      return [
        "You pick each starting weight.",
        `When every set reaches the top of its rep range, the weight goes up ${formatWeight(stepKg, unit)} and the reps go back to the bottom.`,
        ...leftAlone(t),
      ];
    case "fixed_volume": {
      const jump = stepJump(e.increment, unit, stepKg);
      const lines = [startLine(t, e.startPct)];
      const own = unique(exercises(t).filter((ex) => !ex.lift && progresses(ex)).map((ex) => ex.name.toLowerCase()));
      if (own.length) lines.push(`You pick the starting weight for ${listText(own)}.`);
      if (jump) lines.push(`Get every rep on every set and the weight goes up ${jump} next time. Until then it stays the same.`);
      return [...lines, ...leftAlone(t)];
    }
    case "own_rules": {
      const lines = unique(exercises(t).map((ex) => ruleSentence(ex, unit, stepKg)));
      // The engine reads a new max on a test day from each exercise with one of the program's lifts.
      const testMoves = t.weeks.some((w) => w.days.some((d) => d.test && d.exercises.some((ex) => ex.lift && t.lifts.includes(ex.lift))));
      if (testMoves) lines.push("A test day sets a new max from your best set. Its percentages use it from the next session.");
      return lines;
    }
    default: {
      const never: never = e;
      return never;
    }
  }
}
