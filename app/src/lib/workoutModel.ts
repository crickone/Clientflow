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
}
export interface WorkoutDayInput {
  id?: number;
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
  return `${m} min ${s} sec`;
}

export function blankExercise(section: Section): ExerciseInput {
  return { exerciseId: null, section, name: "", sets: 3, reps: "12", restSeconds: 0, notes: null, muscleGroups: [] };
}
export function blankDay(name = "Day 1"): WorkoutDayInput {
  return { name, instructions: null, exercises: [] };
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
