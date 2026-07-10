import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { exerciseLibrary } from "@/lib/db/schema";

export interface ExerciseLibInput {
  id?: number;
  name: string;
  category: string | null;
  muscleGroups: string[];
  equipment: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
  instructions: string | null;
}

export interface ExerciseLibRow {
  id: number;
  name: string;
  category: string | null;
  muscleGroups: string[];
  equipment: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
  instructions: string | null;
}

function parse(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function listExercises(): ExerciseLibRow[] {
  return db
    .select()
    .from(exerciseLibrary)
    .orderBy(asc(exerciseLibrary.name))
    .all()
    .map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      muscleGroups: parse(e.muscleGroups),
      equipment: e.equipment,
      videoUrl: e.videoUrl,
      imageUrl: e.imageUrl,
      instructions: e.instructions,
    }));
}

export function saveExercise(input: ExerciseLibInput): number {
  const base = {
    name: input.name.trim(),
    category: input.category?.trim() || null,
    muscleGroups: input.muscleGroups.map((s) => s.trim()).filter(Boolean).join(",") || null,
    equipment: input.equipment?.trim() || null,
    videoUrl: input.videoUrl?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null,
    instructions: input.instructions,
    updatedAt: new Date(),
  };
  if (input.id) {
    db.update(exerciseLibrary).set(base).where(eq(exerciseLibrary.id, input.id)).run();
    return input.id;
  }
  const [row] = db.insert(exerciseLibrary).values(base).returning({ id: exerciseLibrary.id }).all();
  return row.id;
}

export function deleteExercise(id: number) {
  db.delete(exerciseLibrary).where(eq(exerciseLibrary.id, id)).run();
}
