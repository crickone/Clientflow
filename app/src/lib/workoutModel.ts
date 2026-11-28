// Pure workout model — types + helpers shared by server and client (no server-only).

export type ProgramType = "simple" | "detailed" | "upload";
export type ProgramStatus = "active" | "archived";
export type Section = "warmup" | "workout" | "cooldown";

export const SECTIONS: { key: Section; label: string }[] = [
  { key: "warmup", label: "Warm up" },
  { key: "workout", label: "Workout" },
  { key: "cooldown", label: "Cool down" },
];

export interface ExerciseInput {
  id?: number;
  exerciseId: number | null;
  section: Section;
  name: string;
  sets: number;
  reps: string | null;
  restSeconds: number;
  notes: string | null;
  muscleGroups: string[];
  /** Done back to back with the exercise above (superset or circuit). */
  joined?: boolean;
  /** Target load as the coach wrote it ("70%", "RPE 8", "60 kg"). Free text, never parsed. */
  load?: string | null;
}
export interface WorkoutDayInput {
  id?: number;
  /** 1-based week of the program this day belongs to. */
  week: number;
  name: string;
  instructions: string | null;
  exercises: ExerciseInput[];
}
export interface ProgramInput {
  id?: number;
  title: string;
  type: ProgramType;
  status: ProgramStatus;
  tags: string[];
  summary: string | null;
  content: string | null;
  uploadFilename: string | null;
  uploadOriginalName: string | null;
  days: WorkoutDayInput[];
}

export const PROGRAM_TYPE_LABEL: Record<ProgramType, string> = {
  simple: "Simple",
  detailed: "Detailed",
  upload: "Uploaded",
};

/** A standalone single-day workout (Kahunas "Workout", separate from Programs). */
export interface WorkoutInput {
  id?: number;
  name: string;
  tags: string[];
  instructions: string | null;
  exercises: ExerciseInput[];
}
export function blankWorkout(): WorkoutInput {
  return { name: "New Workout", tags: [], instructions: null, exercises: [] };
}

/** A circuit — a single flat list run for N rounds with rest between rounds. */
export interface CircuitInput {
  id?: number;
  name: string;
  tags: string[];
  rounds: number;
  restBetweenSeconds: number;
  instructions: string | null;
  exercises: ExerciseInput[]; // section is always "workout" for circuits
}
export function blankCircuit(): CircuitInput {
  return { name: "New Circuit", tags: [], rounds: 3, restBetweenSeconds: 0, instructions: null, exercises: [] };
}

/** Total volume sets per muscle group across a day/workout (sets summed per group). */
export function dayVolume(day: { exercises: ExerciseInput[] }): { group: string; sets: number }[] {
  const map = new Map<string, number>();
  for (const ex of day.exercises) {
    for (const g of ex.muscleGroups) {
      const key = g.trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + ex.sets);
    }
  }
  return [...map.entries()]
    .map(([group, sets]) => ({ group, sets }))
    .sort((a, b) => b.sets - a.sets || a.group.localeCompare(b.group));
}

export function fmtRest(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sec`;
  return s === 0 ? `${m} min` : `${m} min ${s} sec`;
}

export function blankExercise(section: Section): ExerciseInput {
  return { exerciseId: null, section, name: "", sets: 3, reps: "12", restSeconds: 0, notes: null, muscleGroups: [] };
}
export function blankDay(name = "Day 1", week = 1): WorkoutDayInput {
  return { week, name, instructions: null, exercises: [] };
}
export function blankProgram(type: ProgramType): ProgramInput {
  return {
    title: "New Program",
    type,
    status: "active",
    tags: [],
    summary: null,
    content: null,
    uploadFilename: null,
    uploadOriginalName: null,
    days: type === "detailed" ? [blankDay("Day 1")] : [],
  };
}

// ── Weeks ───────────────────────────────────────────────────────────────────
// A program is a flat list of days; each day carries the week it belongs to.
// `workout_days.position` is the running index across the whole program
// (ordered by week, then day order), so `workout_sessions.day_position` keeps
// pointing into the same flat list. A program with only week 1 looks and
// behaves exactly as it did before weeks existed.

export const PROGRAM_LIMITS = { maxWeeks: 16, maxDaysPerWeek: 7, maxDays: 112, maxExercisesPerDay: 200 } as const;

/** Longest target load kept, in characters. */
export const MAX_LOAD_LENGTH = 60;

/** A load as stored: trimmed, at most 60 characters, empty -> null. */
export function cleanLoad(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, MAX_LOAD_LENGTH).trim();
  return t || null;
}

function weekOf(day: { week?: unknown }): number {
  const w = day.week;
  return typeof w === "number" && Number.isInteger(w) && w >= 1 ? w : 1;
}

/**
 * Missing or invalid week -> 1; stable sort by week; weeks renumbered 1..K
 * with no gaps. Day order inside a week is kept.
 */
export function normaliseWeeks(days: WorkoutDayInput[]): WorkoutDayInput[] {
  const tagged = days.map((d, i) => ({ d, i, w: weekOf(d) }));
  tagged.sort((a, b) => a.w - b.w || a.i - b.i);
  const renumber = new Map<number, number>();
  for (const t of tagged) if (!renumber.has(t.w)) renumber.set(t.w, renumber.size + 1);
  return tagged.map((t) => ({ ...t.d, week: renumber.get(t.w)! }));
}

/** How many distinct weeks the program has (0 when it has no days). */
export function weekCount(days: { week?: unknown }[]): number {
  return new Set(days.map(weekOf)).size;
}

export function daysInWeek(days: WorkoutDayInput[], week: number): WorkoutDayInput[] {
  return days.filter((d) => weekOf(d) === week);
}

/** Weeks, days per week (null when the weeks differ in day count), total days. */
export function programShape(days: { week?: unknown }[]): { weeks: number; daysPerWeek: number | null; totalDays: number } {
  const per = new Map<number, number>();
  for (const d of days) per.set(weekOf(d), (per.get(weekOf(d)) ?? 0) + 1);
  const counts = [...per.values()];
  const same = counts.length > 0 && counts.every((c) => c === counts[0]);
  return { weeks: per.size, daysPerWeek: counts.length === 0 ? 0 : same ? counts[0] : null, totalDays: days.length };
}

/**
 * What a day is called. One week: the day's own name, falling back to
 * "Day N" (N within the program), exactly as before weeks. Several weeks:
 * "Week W · <name>", the name falling back to "Day N" with N counted within
 * its week. Expects normalised days (see normaliseWeeks).
 */
export function dayLabel(days: { week?: unknown; name: string }[], index: number): string {
  const day = days[index];
  if (!day) return `Day ${index + 1}`;
  if (weekCount(days) <= 1) return day.name.trim() || `Day ${index + 1}`;
  const w = weekOf(day);
  let n = 0;
  for (let i = 0; i <= index; i++) if (weekOf(days[i]) === w) n++;
  return `Week ${w} · ${day.name.trim() || `Day ${n}`}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "4 days", "8 weeks, 4 days a week" or "3 weeks, 10 days". */
export function shapeLabel(days: { week?: unknown }[]): string {
  const s = programShape(days);
  if (s.weeks <= 1) return plural(s.totalDays, "day");
  if (s.daysPerWeek !== null) return `${plural(s.weeks, "week")}, ${plural(s.daysPerWeek, "day")} a week`;
  return `${plural(s.weeks, "week")}, ${plural(s.totalDays, "day")}`;
}

/** Plain error text when the program is over a limit, else null. */
export function checkProgramLimits(days: WorkoutDayInput[]): string | null {
  const L = PROGRAM_LIMITS;
  if (days.length > L.maxDays) return `A program can have at most ${L.maxDays} days. This one has ${days.length}.`;
  const norm = normaliseWeeks(days);
  const weeks = weekCount(norm);
  if (weeks > L.maxWeeks) return `A program can have at most ${L.maxWeeks} weeks. This one has ${weeks}.`;
  for (let w = 1; w <= weeks; w++) {
    const n = daysInWeek(norm, w).length;
    if (n > L.maxDaysPerWeek) return `Week ${w} has ${n} days. A week can have at most ${L.maxDaysPerWeek}.`;
  }
  for (let i = 0; i < norm.length; i++) {
    const n = norm[i].exercises.length;
    if (n > L.maxExercisesPerDay) return `${dayLabel(norm, i)} has ${n} exercises. A day can have at most ${L.maxExercisesPerDay}.`;
  }
  return null;
}

/**
 * The program with a copy of `week`'s days (ids stripped, exercises deep
 * copied) appended as a new last week. Unchanged when that week has no days.
 */
export function copyWeek(days: WorkoutDayInput[], week: number): WorkoutDayInput[] {
  const norm = normaliseWeeks(days);
  const source = daysInWeek(norm, week);
  if (source.length === 0) return norm;
  const next = weekCount(norm) + 1;
  const copies = source.map(({ id: _id, ...d }) => ({
    ...d,
    week: next,
    exercises: d.exercises.map(({ id: _xid, ...ex }) => ({ ...ex, muscleGroups: [...ex.muscleGroups] })),
  }));
  return [...norm, ...copies];
}
