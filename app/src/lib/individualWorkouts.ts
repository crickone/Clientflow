import "server-only";

import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { workoutItems, workouts } from "@/lib/db/schema";
import type { Section, WorkoutInput } from "@/lib/workoutModel";

function parseTags(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split(",").map((t) => t.trim()).filter(Boolean);
}

export interface WorkoutListRow {
  id: number;
  name: string;
  tags: string[];
  exerciseCount: number;
  createdAt: number;
  updatedAt: number;
}

export function listWorkouts(): WorkoutListRow[] {
  const rows = db.select().from(workouts).orderBy(desc(workouts.updatedAt)).all();
  if (rows.length === 0) return [];
  const ids = rows.map((w) => w.id);
  const items = db
    .select({ id: workoutItems.id, workoutId: workoutItems.workoutId })
    .from(workoutItems)
    .where(inArray(workoutItems.workoutId, ids))
    .all();
  const countByWorkout = new Map<number, number>();
  for (const it of items) countByWorkout.set(it.workoutId, (countByWorkout.get(it.workoutId) ?? 0) + 1);
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    tags: parseTags(w.tags),
    exerciseCount: countByWorkout.get(w.id) ?? 0,
    createdAt: w.createdAt.getTime(),
    updatedAt: w.updatedAt.getTime(),
  }));
}

export function getWorkout(id: number): WorkoutInput | null {
  const w = db.select().from(workouts).where(eq(workouts.id, id)).get();
  if (!w) return null;
  const items = db
    .select()
    .from(workoutItems)
    .where(eq(workoutItems.workoutId, id))
    .orderBy(asc(workoutItems.position))
    .all();
  return {
    id: w.id,
    name: w.name,
    tags: parseTags(w.tags),
    instructions: w.instructions,
    exercises: items.map((it) => ({
      id: it.id,
      exerciseId: it.exerciseId,
      section: it.section as Section,
      name: it.name,
      sets: it.sets,
      reps: it.reps,
      restSeconds: it.restSeconds,
      notes: it.notes,
      muscleGroups: parseTags(it.muscleGroups),
    })),
  };
}

export function saveWorkout(input: WorkoutInput): number {
  return db.transaction((tx) => {
    const base = {
      name: input.name.trim() || "New Workout",
      tags: input.tags.map((t) => t.trim()).filter(Boolean).join(",") || null,
      instructions: input.instructions,
      updatedAt: new Date(),
    };
    let workoutId = input.id ?? 0;
    if (workoutId) {
      tx.update(workouts).set(base).where(eq(workouts.id, workoutId)).run();
      tx.delete(workoutItems).where(eq(workoutItems.workoutId, workoutId)).run();
    } else {
      const [row] = tx.insert(workouts).values(base).returning({ id: workouts.id }).all();
      workoutId = row.id;
    }
    input.exercises.forEach((ex, xi) => {
      if (!ex.name.trim()) return;
      tx.insert(workoutItems)
        .values({
          workoutId,
          section: ex.section,
          exerciseId: ex.exerciseId,
          name: ex.name.trim(),
          position: xi,
          sets: ex.sets,
          reps: ex.reps,
          restSeconds: ex.restSeconds,
          notes: ex.notes,
          muscleGroups: ex.muscleGroups.map((g) => g.trim()).filter(Boolean).join(",") || null,
        })
        .run();
    });
    return workoutId;
  });
}

export function deleteWorkout(id: number) {
  db.delete(workouts).where(eq(workouts.id, id)).run();
}

export function duplicateWorkout(id: number): number | null {
  const w = getWorkout(id);
  if (!w) return null;
  return saveWorkout({ ...w, id: undefined, name: `${w.name} (copy)` });
}
