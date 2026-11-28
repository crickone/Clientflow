"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteProgram, duplicateProgram, getProgram, saveProgram, setProgramStatus } from "@/lib/workout";
import { importProgramFromUpload } from "@/lib/workoutImport/convert";
import { PROGRAM_LIMITS, checkProgramLimits, type ProgramInput } from "@/lib/workoutModel";

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
  joined: z.boolean().default(false),
  load: z.string().trim().max(60, "A load can be at most 60 characters.").nullable().optional(),
});
const daySchema = z.object({
  id: z.number().int().positive().optional(),
  week: z.number().int().min(1).max(PROGRAM_LIMITS.maxWeeks).default(1),
  name: z.string().trim().max(120),
  instructions: z.string().trim().max(8000).nullable().default(null),
  exercises: z.array(exerciseSchema).max(PROGRAM_LIMITS.maxExercisesPerDay),
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
  days: z.array(daySchema).max(PROGRAM_LIMITS.maxDays, `A program can have at most ${PROGRAM_LIMITS.maxDays} days.`),
});

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

export async function saveProgramAction(raw: unknown): Promise<SaveResult> {
  await requireUser();
  const parsed = programSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid program." };
  const limitError = checkProgramLimits(parsed.data.days);
  if (limitError) return { ok: false, error: limitError };
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

export type BuildFromUploadResult = { ok: true; program: ProgramInput; unplaced: string[] } | { ok: false; error: string };

/**
 * "Build from this file": Adonis reads an Upload program's spreadsheet and
 * hands back a new Detailed program for the builder. Nothing is saved here;
 * the operator checks it in the builder and saves it there.
 */
export async function buildProgramFromUploadAction(programId: number): Promise<BuildFromUploadResult> {
  await requireUser();
  const p = idSchema.safeParse(programId);
  if (!p.success) return { ok: false, error: "I can't find that program." };
  const program = getProgram(p.data);
  if (!program) return { ok: false, error: "I can't find that program." };
  if (program.type !== "upload") return { ok: false, error: "Only an uploaded program can be built from its file." };
  const result = await importProgramFromUpload(p.data);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, program: result.program, unplaced: result.unplaced };
}
