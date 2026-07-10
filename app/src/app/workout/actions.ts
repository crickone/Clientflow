"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteProgram, duplicateProgram, saveProgram, setProgramStatus } from "@/lib/workout";
import type { ProgramInput } from "@/lib/workoutModel";

const exerciseSchema = z.object({
  id: z.number().int().positive().optional(),
  exerciseId: z.number().int().positive().nullable().default(null),
  section: z.enum(["warmup", "workout", "cooldown"]),
  name: z.string().trim().max(200),
  sets: z.coerce.number().int().min(0).max(100).catch(0),
  reps: z.string().trim().max(60).nullable().default(null),
  restSeconds: z.coerce.number().int().min(0).max(86400).catch(0),
  notes: z.string().trim().max(2000).nullable().default(null),
  muscleGroups: z.array(z.string().trim().max(60)).max(20).default([]),
});
const daySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().max(120),
  instructions: z.string().trim().max(8000).nullable().default(null),
  exercises: z.array(exerciseSchema).max(200),
});
const programSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(1, "Give the program a title.").max(200),
  type: z.enum(["simple", "detailed", "upload"]),
  status: z.enum(["active", "archived"]).default("active"),
  tags: z.array(z.string().trim().max(80)).max(30).default([]),
  summary: z.string().trim().max(8000).nullable().default(null),
  content: z.string().trim().max(100000).nullable().default(null),
  uploadFilename: z.string().trim().max(300).nullable().default(null),
  uploadOriginalName: z.string().trim().max(300).nullable().default(null),
  days: z.array(daySchema).max(31),
});

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

export async function saveProgramAction(raw: unknown): Promise<SaveResult> {
  await requireUser();
  const parsed = programSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid program." };
  const id = saveProgram(parsed.data as ProgramInput);
  revalidatePath("/workout");
  revalidatePath(`/workout/${id}`);
  return { ok: true, id };
}

const idSchema = z.coerce.number().int().positive();

export async function deleteProgramAction(id: number) {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  deleteProgram(p.data);
  revalidatePath("/workout");
}

export async function duplicateProgramAction(id: number): Promise<SaveResult> {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const newId = duplicateProgram(p.data);
  if (!newId) return { ok: false, error: "Program not found." };
  revalidatePath("/workout");
  return { ok: true, id: newId };
}

export async function setProgramStatusAction(id: number, status: "active" | "archived") {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  setProgramStatus(p.data, status);
  revalidatePath("/workout");
}
