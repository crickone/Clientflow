"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteCircuit, duplicateCircuit, saveCircuit } from "@/lib/circuits";
import type { CircuitInput } from "@/lib/workoutModel";

const exerciseSchema = z.object({
  id: z.number().int().positive().optional(),
  exerciseId: z.number().int().positive().nullable().default(null),
  section: z.enum(["warmup", "workout", "cooldown"]).default("workout"),
  name: z.string().trim().max(200),
  sets: z.coerce.number().int().min(0).max(100).catch(0),
  reps: z.string().trim().max(60).nullable().default(null),
  restSeconds: z.coerce.number().int().min(0).max(86400).catch(0),
  notes: z.string().trim().max(2000).nullable().default(null),
  muscleGroups: z.array(z.string().trim().max(60)).max(20).default([]),
});
const schema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Give the circuit a name.").max(200),
  tags: z.array(z.string().trim().max(80)).max(30).default([]),
  rounds: z.coerce.number().int().min(1).max(100).catch(1),
  restBetweenSeconds: z.coerce.number().int().min(0).max(86400).catch(0),
  instructions: z.string().trim().max(8000).nullable().default(null),
  exercises: z.array(exerciseSchema).max(200),
});

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

export async function saveCircuitAction(raw: unknown): Promise<SaveResult> {
  await requireUser();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid circuit." };
  const id = saveCircuit(parsed.data as CircuitInput);
  revalidatePath("/workout/circuits");
  revalidatePath(`/workout/circuits/${id}`);
  return { ok: true, id };
}

const idSchema = z.coerce.number().int().positive();

export async function deleteCircuitAction(id: number) {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  deleteCircuit(p.data);
  revalidatePath("/workout/circuits");
}

export async function duplicateCircuitAction(id: number): Promise<SaveResult> {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const newId = duplicateCircuit(p.data);
  if (!newId) return { ok: false, error: "Circuit not found." };
  revalidatePath("/workout/circuits");
  return { ok: true, id: newId };
}
