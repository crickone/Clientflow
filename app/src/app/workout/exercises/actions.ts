"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteExercise, saveExercise, type ExerciseLibInput } from "@/lib/exerciseLibrary";

const schema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Give the exercise a name.").max(200),
  category: z.string().trim().max(80).nullable().default(null),
  muscleGroups: z.array(z.string().trim().max(60)).max(20).default([]),
  equipment: z.string().trim().max(120).nullable().default(null),
  videoUrl: z.string().trim().max(500).nullable().default(null),
  imageUrl: z.string().trim().max(500).nullable().default(null),
  instructions: z.string().trim().max(4000).nullable().default(null),
});

export type ExerciseResult = { ok: true; id: number } | { ok: false; error: string };

export async function saveExerciseAction(raw: unknown): Promise<ExerciseResult> {
  await requireUser();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid exercise." };
  const id = saveExercise(parsed.data as ExerciseLibInput);
  revalidatePath("/workout/exercises");
  revalidatePath("/workout");
  return { ok: true, id };
}

export async function deleteExerciseAction(id: number) {
  await requireUser();
  const p = z.coerce.number().int().positive().safeParse(id);
  if (!p.success) return;
  deleteExercise(p.data);
  revalidatePath("/workout/exercises");
}
