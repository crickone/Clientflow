// app/src/lib/programs/types.ts
/**
 * The program library's shapes (docs/superpowers/specs/2026-11-12-diy-program-library-design.md).
 * Pure: no server imports. Templates, the planner, the engines, the member app
 * and the staff screens all share these.
 */

export type WeightUnit = "kg" | "lb";

export type LiftKey = "squat" | "bench" | "deadlift" | "press" | "row";
export const LIFT_KEYS: readonly LiftKey[] = ["squat", "bench", "deadlift", "press", "row"];
export const LIFT_LABEL: Record<LiftKey, string> = {
  squat: "Squat",
  bench: "Bench press",
  deadlift: "Deadlift",
  press: "Overhead press",
  row: "Barbell row",
};
/** The canonical exercise whose logs count as this lift's history (best logged set). */
export const LIFT_EXERCISE: Record<LiftKey, string> = {
  squat: "Back squat",
  bench: "Bench press",
  deadlift: "Deadlift",
  press: "Overhead press",
  row: "Barbell row",
};

export type Family = "strength" | "peaking" | "beginner" | "size";
export const FAMILY_LABEL: Record<Family, string> = {
  strength: "Strength",
  peaking: "Powerlifting peak",
  beginner: "Beginner",
  size: "Size",
};

export type Level = "beginner" | "intermediate" | "advanced";
export const LEVEL_LABEL: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export type EngineKey = "linear" | "tm_cycle" | "fixed_block" | "double_progression" | "fixed_volume" | "own_rules";
export const ENGINE_LABEL: Record<EngineKey, string> = {
  linear: "Linear, with deloads",
  tm_cycle: "Training-max cycles",
  fixed_block: "Fixed block with a re-test",
  double_progression: "Double progression",
  fixed_volume: "Fixed volume",
  own_rules: "Your own rules",
};

/** A rep count, or a range for rep-range programs. */
export type Reps = number | { min: number; max: number };

/**
 * One prescribed set.
 * - pct: a fraction of the lift's training max (0.7 = 70%), plus an optional fixed kg on top.
 * - amrap: the same, and the member does as many reps as they can (reps = the minimum).
 * - rpe: a target effort; the weight is suggested from the member's best estimated max.
 * - fixed: the weight comes from the engine's state for this exercise.
 * - same_as_last: the previous set's weight.
 * `drives` marks the set whose result moves the training max (nSuns 1+ set, Texas top set).
 */
export type SetRx =
  | { kind: "pct"; pct: number; reps: number; rest: number; addKg?: number; drives?: boolean }
  | { kind: "amrap"; pct: number; reps: number; rest: number; addKg?: number; drives?: boolean }
  | { kind: "rpe"; rpe: number; reps: number; rest: number }
  | { kind: "fixed"; reps: Reps; rest: number; amrap?: boolean }
  | { kind: "same_as_last"; reps: Reps; rest: number };

/**
 * How a member-built program (engine own_rules) moves one exercise's weight.
 * - linear: every set is a fixed rep count; a session with every rep adds incKg,
 *   and deloadAfter misses in a row make it 10% lighter.
 * - range: every set is a rep range; when every set reaches the top it adds incKg
 *   (default: the member's smallest jump) and goes back to the bottom.
 * - percent: every set is a percentage of the exercise's lift max (ExerciseRx.lift).
 * - rpe: every set is an RPE target; the weight is suggested from the member's
 *   best logged set of the exercise.
 * - manual: nothing changes; the planned weight is last time's.
 * startKg is the weight the exercise starts at (linear, range, manual).
 */
export type OwnRule =
  | { kind: "linear"; incKg: number; deloadAfter: number; startKg?: number }
  | { kind: "range"; incKg?: number; startKg?: number }
  | { kind: "percent" }
  | { kind: "rpe" }
  | { kind: "manual"; startKg?: number };
export type RuleKind = OwnRule["kind"];
export const RULE_KINDS: readonly RuleKind[] = ["linear", "range", "percent", "rpe", "manual"];
export const RULE_LABEL: Record<RuleKind, string> = {
  linear: "Add weight",
  range: "Rep range",
  percent: "Percent of max",
  rpe: "RPE",
  manual: "Manual",
};
/** An own-rules deload is always 10% lighter. */
export const OWN_DELOAD_PCT = 0.1;

export interface ExerciseRx {
  /** A name from the canonical list (exercises.ts). */
  name: string;
  /** The max this exercise's percentages and starting weight come from. */
  lift?: LiftKey;
  /** GZCLP tier. Also part of the state key, so T1 squat and T2 squat keep separate weights. */
  tier?: "t1" | "t2" | "t3";
  sets: SetRx[];
  /** GZCLP: the rep schemes the exercise moves through when it fails. sets === stages[0]. */
  stages?: SetRx[][];
  bodyweight?: boolean;
  /** false: the engine never changes this exercise's weight (speed sets, light accessories). */
  progress?: boolean;
  /** Starting weight as a fraction of the lift's max, overriding the engine's startPct. */
  startPct?: number;
  /** Done back to back with the exercise above (superset). */
  joined?: boolean;
  notes?: string;
  /** Member-built programs only: how this exercise progresses. */
  rule?: OwnRule;
}

export interface DayRx {
  name: string;
  exercises: ExerciseRx[];
  /** A test day: the engine reads the member's new max from it. */
  test?: boolean;
}

export interface WeekRx {
  label?: string;
  days: DayRx[];
}

export interface LinearSettings {
  key: "linear";
  increment: number;
  increments?: Partial<Record<LiftKey, number>>;
  /** Misses in a row on a lift before it drops. */
  deloadAfter: number;
  /** 0.1 = 10% lighter. */
  deloadPct: number;
  /** Starting weight as a fraction of the entered max. */
  startPct: number;
  /** AMRAP reps at or above this double the jump (Greyskull). */
  doubleAt?: number;
}

export interface TmCycleSettings {
  key: "tm_cycle";
  /**
   * cycle: training max rises at the end of each cycle (5/3/1).
   * amrap_table: training max moves by the reps on the driving AMRAP set (nSuns).
   * drive_set: training max rises when the driving set is completed (Texas Method).
   * gzclp: per-exercise weights move through rep schemes (GZCLP).
   */
  rule: "cycle" | "amrap_table" | "drive_set" | "gzclp";
  increment: number;
  increments?: Partial<Record<LiftKey, number>>;
  amrapTable?: { minReps: number; kg: number }[];
  t2ResetKg?: number;
  t3AmrapTarget?: number;
  startPct?: number;
}

export interface FixedBlockSettings {
  key: "fixed_block";
}

export interface DoubleProgressionSettings {
  key: "double_progression";
}

/** A member-built program: each exercise carries its own rule. */
export interface OwnRulesSettings {
  key: "own_rules";
}

export interface FixedVolumeSettings {
  key: "fixed_volume";
  increment: number;
  startPct: number;
}

export type EngineSettings = LinearSettings | TmCycleSettings | FixedBlockSettings | DoubleProgressionSettings | FixedVolumeSettings | OwnRulesSettings;

/** One stretch of a program, in the program's own week numbers (1-based, inclusive). */
export interface Phase {
  name: string;
  fromWeek: number;
  toWeek: number;
  /** What the phase is like, in a sentence or two. */
  note: string;
}

export interface ProgramTemplate {
  key: string;
  name: string;
  /** One line, e.g. "5/3/1 by Jim Wendler". */
  author: string;
  family: Family;
  level: Level;
  daysPerWeek: number;
  /** The length shown on the card. Repeating programs loop their weeks until then and beyond. */
  lengthWeeks: number;
  /** The lifts the member gives a max for. */
  lifts: LiftKey[];
  /** Training max as a fraction of the max (5/3/1 uses 0.9). */
  tmPct: number;
  /** Who it is for, one line. */
  who: string;
  /** Our own words. */
  description: string;
  /** For demanding programs. */
  warning?: string;
  /** One plain line for the card and the top of the program page. Platform programs always have one. */
  summary?: string;
  /**
   * The program's shape, in order, with no gaps. Without phasesRepeat they run
   * from week 1 to lengthWeeks; with it they describe one pass through `weeks`,
   * which then repeats.
   */
  phases?: Phase[];
  phasesRepeat?: boolean;
  /** Two or three short sentences on the method. No claims of results. */
  whyItWorks?: string;
  engine: EngineSettings;
  weeks: WeekRx[];
}

/** Everything an engine carries between sessions. Position is week/day within the template. */
export interface EngineState {
  week: number;
  day: number;
  /** Completed passes through the template. */
  cycle: number;
  maxes: Partial<Record<LiftKey, number>>;
  tms: Partial<Record<LiftKey, number>>;
  /** Working weight per state key (fixed-weight programs). */
  weights: Record<string, number>;
  misses: Record<string, number>;
  stages: Record<string, number>;
  /** 5/3/1: a + set fell short of its minimum this cycle. */
  short: Partial<Record<LiftKey, boolean>>;
  /** GZCLP: the weight T2 last started its 3 x 10 at. */
  t2Base: Record<string, number>;
  /** Fixed block: the new maxes read from the test day. */
  testMaxes: Partial<Record<LiftKey, number>>;
  /** Fixed block: the last session is done. */
  finished: boolean;
}

export function emptyState(): EngineState {
  return { week: 0, day: 0, cycle: 0, maxes: {}, tms: {}, weights: {}, misses: {}, stages: {}, short: {}, t2Base: {}, testMaxes: {}, finished: false };
}

export interface PlannedSet {
  kg: number | null;
  reps: number;
  repsMax: number | null;
  amrap: boolean;
  rpe: number | null;
  pct: number | null;
  rest: number;
  drives: boolean;
}

export interface PlannedExercise {
  /** Index of the exercise in the template day. */
  index: number;
  name: string;
  lift: LiftKey | null;
  tier: "t1" | "t2" | "t3" | null;
  stateKey: string;
  bodyweight: boolean;
  /** The engine can change this exercise's weight. */
  progresses: boolean;
  joined: boolean;
  notes: string | null;
  sets: PlannedSet[];
  /** Member-built programs: the exercise's rule, kept in the session's rx_json so an open session finishes on the version it started from. */
  rule?: OwnRule;
}

export interface PlannedSession {
  week: number;
  day: number;
  /** Sessions before this one in the template: the logger's day_position. */
  position: number;
  dayName: string;
  weekLabel: string | null;
  test: boolean;
  exercises: PlannedExercise[];
}

export interface DoneSet {
  kg: number | null;
  reps: number | null;
  done: boolean;
}

export interface ExerciseResult {
  planned: PlannedExercise;
  sets: DoneSet[];
}

export interface SessionResult {
  exercises: ExerciseResult[];
}
