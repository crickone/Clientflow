// Pure workout-log model: types + set maths shared by server and client (no server-only).

export interface LoggedSet {
  weightKg: number | null;
  reps: number | null;
  done: boolean;
}

/** One exercise inside a logged session: what the coach set, and what was lifted. */
export interface SessionExercise {
  id: number;
  section: "warmup" | "workout" | "cooldown";
  exerciseKey: string;
  name: string;
  targetSets: number;
  targetReps: string | null;
  restSeconds: number;
  notes: string | null;
  sets: LoggedSet[];
}

export interface SessionView {
  id: number;
  clientId: number;
  programId: number | null;
  dayPosition: number;
  programTitle: string;
  dayName: string;
  startedAt: number;
  finishedAt: number | null;
  exercises: SessionExercise[];
}

/** Library exercises key by id, anything typed in by name, so history follows the exercise across programmes. */
export function exerciseKey(exerciseId: number | null | undefined, name: string): string {
  if (exerciseId) return `lib:${exerciseId}`;
  return `name:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** "62.5", "62,5", " 60 " -> number; blank or nonsense -> null. Rounded to 0.25 kg. */
export function parseWeight(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
  return Math.round(n * 4) / 4;
}

export function parseReps(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/**
 * The first whole number in a rep target like "8-10", "12" or "10 reps", used
 * to prefill reps. A timed target ("30-45 seconds", "5 minutes") is not reps.
 */
export function targetRepsNumber(target: string | null): number | null {
  if (!target || /[a-z]/i.test(target.replace(/\b(reps?|each( side| leg| arm)?|per side|x)\b/gi, ""))) return null;
  const m = target.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n > 0 && n < 1000 ? n : null;
}

export function formatKg(kg: number): string {
  return `${Number(kg.toFixed(2))} kg`;
}

export function formatSet(s: Pick<LoggedSet, "weightKg" | "reps">): string {
  if (s.weightKg !== null && s.weightKg > 0 && s.reps !== null) return `${formatKg(s.weightKg)} x ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.weightKg !== null && s.weightKg > 0) return formatKg(s.weightKg);
  return "Done";
}

/** Estimated one-rep max (Epley). A single is the lift itself. */
export function estimatedMax(weightKg: number, reps: number): number {
  if (reps <= 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** The strongest completed set by estimated max, or null if none carried a weight. */
export function bestSet(sets: LoggedSet[]): { weightKg: number; reps: number; e1rm: number } | null {
  let best: { weightKg: number; reps: number; e1rm: number } | null = null;
  for (const s of sets) {
    if (!s.done || s.weightKg === null || s.weightKg <= 0 || s.reps === null) continue;
    const e1rm = estimatedMax(s.weightKg, s.reps);
    if (!best || e1rm > best.e1rm || (e1rm === best.e1rm && s.weightKg > best.weightKg)) best = { weightKg: s.weightKg, reps: s.reps, e1rm };
  }
  return best;
}

/** Total kg moved (weight x reps over completed sets). */
export function volumeKg(exercises: Pick<SessionExercise, "sets">[]): number {
  let total = 0;
  for (const ex of exercises) for (const s of ex.sets) if (s.done && s.weightKg && s.reps) total += s.weightKg * s.reps;
  return Math.round(total);
}

export function setsDone(exercises: Pick<SessionExercise, "sets">[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const ex of exercises) {
    total += ex.sets.length;
    done += ex.sets.filter((s) => s.done).length;
  }
  return { done, total };
}

/**
 * Ticking a set off with a blank box fills it from what the member did on
 * that set last time, else the set above it today, else (reps only) the
 * coach's target. A box they typed in is kept.
 */
export function completeSet(
  set: Pick<LoggedSet, "weightKg" | "reps">,
  previous: Pick<LoggedSet, "weightKg" | "reps"> | undefined,
  above: Pick<LoggedSet, "weightKg" | "reps"> | undefined,
  targetReps: string | null,
): LoggedSet {
  return {
    done: true,
    weightKg: set.weightKg ?? previous?.weightKg ?? above?.weightKg ?? null,
    reps: set.reps ?? previous?.reps ?? above?.reps ?? targetRepsNumber(targetReps),
  };
}

/** Exercises whose best set today beats every earlier session's best. */
export function personalBests(
  exercises: Pick<SessionExercise, "exerciseKey" | "name" | "sets">[],
  priorBest: Record<string, number>,
): { name: string; weightKg: number; reps: number }[] {
  const out: { name: string; weightKg: number; reps: number }[] = [];
  for (const ex of exercises) {
    const b = bestSet(ex.sets);
    if (!b) continue;
    const before = priorBest[ex.exerciseKey];
    if (before !== undefined && b.e1rm > before + 1e-9) out.push({ name: ex.name, weightKg: b.weightKg, reps: b.reps });
  }
  return out;
}

export function durationLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function restLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
