import "server-only";

import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { workoutDays, workoutExercises, workoutPrograms } from "@/lib/db/schema";
import { checkProgramLimits, cleanLoad, normaliseWeeks, type ProgramInput, type ProgramStatus, type ProgramType, type Section } from "@/lib/workoutModel";

function parseTags(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split(",").map((t) => t.trim()).filter(Boolean);
}
function parseGroups(csv: string | null): string[] {
  return parseTags(csv);
}

export interface ProgramListRow {
  id: number;
  title: string;
  type: ProgramType;
  status: ProgramStatus;
  tags: string[];
  dayCount: number;
  /** Distinct weeks (0 for a program with no days). */
  weekCount: number;
  exerciseCount: number;
  createdAt: number;
  updatedAt: number;
  uploadOriginalName: string | null;
}

export function listPrograms(): ProgramListRow[] {
  const programs = db.select().from(workoutPrograms).orderBy(desc(workoutPrograms.updatedAt)).all();
  if (programs.length === 0) return [];
  const ids = programs.map((p) => p.id);
  const days = db.select().from(workoutDays).where(inArray(workoutDays.programId, ids)).all();
  const dayIds = days.map((d) => d.id);
  const exercises = dayIds.length
    ? db.select({ id: workoutExercises.id, dayId: workoutExercises.dayId }).from(workoutExercises).where(inArray(workoutExercises.dayId, dayIds)).all()
    : [];

  const daysByProgram = new Map<number, number>();
  for (const d of days) daysByProgram.set(d.programId, (daysByProgram.get(d.programId) ?? 0) + 1);
  const weeksByProgram = new Map<number, Set<number>>();
  for (const d of days) {
    const set = weeksByProgram.get(d.programId) ?? new Set<number>();
    set.add(d.week);
    weeksByProgram.set(d.programId, set);
  }
  const exByDay = new Map<number, number>();
  for (const e of exercises) exByDay.set(e.dayId, (exByDay.get(e.dayId) ?? 0) + 1);
  const exByProgram = new Map<number, number>();
  for (const d of days) exByProgram.set(d.programId, (exByProgram.get(d.programId) ?? 0) + (exByDay.get(d.id) ?? 0));

  return programs.map((p) => ({
    id: p.id,
    title: p.title,
    type: p.type,
    status: p.status,
    tags: parseTags(p.tags),
    dayCount: daysByProgram.get(p.id) ?? 0,
    weekCount: weeksByProgram.get(p.id)?.size ?? 0,
    exerciseCount: exByProgram.get(p.id) ?? 0,
    createdAt: p.createdAt.getTime(),
    updatedAt: p.updatedAt.getTime(),
    uploadOriginalName: p.uploadOriginalName,
  }));
}

export function getProgram(id: number): ProgramInput | null {
  const program = db.select().from(workoutPrograms).where(eq(workoutPrograms.id, id)).get();
  if (!program) return null;
  const days = db
    .select()
    .from(workoutDays)
    .where(eq(workoutDays.programId, id))
    .orderBy(asc(workoutDays.position))
    .all();
  const dayIds = days.map((d) => d.id);
  const exercises = dayIds.length
    ? db
        .select()
        .from(workoutExercises)
        .where(inArray(workoutExercises.dayId, dayIds))
        .orderBy(asc(workoutExercises.position))
        .all()
    : [];

  return {
    id: program.id,
    title: program.title,
    type: program.type,
    status: program.status,
    tags: parseTags(program.tags),
    summary: program.summary,
    content: program.content,
    uploadFilename: program.uploadFilename,
    uploadOriginalName: program.uploadOriginalName,
    days: days.map((d) => ({
      id: d.id,
      week: d.week,
      name: d.name,
      instructions: d.instructions,
      exercises: exercises
        .filter((e) => e.dayId === d.id)
        .map((e) => ({
          id: e.id,
          exerciseId: e.exerciseId,
          section: e.section as Section,
          name: e.name,
          sets: e.sets,
          reps: e.reps,
          restSeconds: e.restSeconds,
          notes: e.notes,
          muscleGroups: parseGroups(e.muscleGroups),
          joined: e.joined,
          load: e.load,
        })),
    })),
  };
}

/**
 * Create or replace a program. Days are normalised to weeks 1..K (see
 * normaliseWeeks) and checked against PROGRAM_LIMITS (throws a plain Error
 * when over). `position` is the running index across the whole program.
 */
export function saveProgram(input: ProgramInput): number {
  const days = normaliseWeeks(input.days);
  const limitError = checkProgramLimits(days);
  if (limitError) throw new Error(limitError);
  return db.transaction((tx) => {
    const base = {
      title: input.title.trim() || "New Program",
      type: input.type,
      status: input.status,
      tags: input.tags.map((t) => t.trim()).filter(Boolean).join(",") || null,
      summary: input.summary,
      content: input.content,
      uploadFilename: input.uploadFilename,
      uploadOriginalName: input.uploadOriginalName,
      updatedAt: new Date(),
    };
    let programId = input.id ?? 0;
    if (programId) {
      tx.update(workoutPrograms).set(base).where(eq(workoutPrograms.id, programId)).run();
      tx.delete(workoutDays).where(eq(workoutDays.programId, programId)).run();
    } else {
      const [row] = tx.insert(workoutPrograms).values(base).returning({ id: workoutPrograms.id }).all();
      programId = row.id;
    }
    const inWeek = new Map<number, number>();
    days.forEach((day, di) => {
      const n = (inWeek.get(day.week) ?? 0) + 1;
      inWeek.set(day.week, n);
      const [dayRow] = tx
        .insert(workoutDays)
        .values({
          programId,
          week: day.week,
          // Fallback counts within the week; for a one-week program that is di + 1, as before.
          name: day.name.trim() || `Day ${n}`,
          position: di,
          instructions: day.instructions,
        })
        .returning({ id: workoutDays.id })
        .all();
      day.exercises.forEach((ex, xi) => {
        if (!ex.name.trim()) return;
        tx.insert(workoutExercises)
          .values({
            dayId: dayRow.id,
            section: ex.section,
            exerciseId: ex.exerciseId,
            name: ex.name.trim(),
            position: xi,
            sets: ex.sets,
            reps: ex.reps,
            restSeconds: ex.restSeconds,
            notes: ex.notes,
            joined: ex.joined === true,
            load: cleanLoad(ex.load),
            muscleGroups: ex.muscleGroups.map((g) => g.trim()).filter(Boolean).join(",") || null,
          })
          .run();
      });
    });
    return programId;
  });
}

export function deleteProgram(id: number) {
  db.delete(workoutPrograms).where(eq(workoutPrograms.id, id)).run();
}

export function setProgramStatus(id: number, status: ProgramStatus) {
  db.update(workoutPrograms).set({ status, updatedAt: new Date() }).where(eq(workoutPrograms.id, id)).run();
}

export function duplicateProgram(id: number): number | null {
  const p = getProgram(id);
  if (!p) return null;
  return saveProgram({ ...p, id: undefined, title: `${p.title} (copy)`, status: "active" });
}
