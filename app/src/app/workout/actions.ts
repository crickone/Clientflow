"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentMembership, requireUser } from "@/lib/auth";
import { deleteProgram, duplicateProgram, getProgram, saveProgram, setProgramStatus } from "@/lib/workout";
import { importProgramFromUpload } from "@/lib/workoutImport/convert";
import { readJob, startJob } from "@/lib/workoutImport/jobs";
import { MAX_LOAD_LENGTH, PROGRAM_LIMITS, PROGRAM_TEXT_LIMITS as T, checkProgramLimits, type ProgramInput } from "@/lib/workoutModel";

const exerciseSchema = z.object({
  id: z.number().int().positive().optional(),
  exerciseId: z.number().int().positive().nullable().default(null),
  section: z.enum(["warmup", "workout", "cooldown"]),
  name: z.string().trim().max(T.exerciseName),
  sets: z.coerce.number().int().min(0).max(T.maxSets).catch(0),
  reps: z.string().trim().max(T.reps).nullable().default(null),
  restSeconds: z.coerce.number().int().min(0).max(T.maxRestSeconds).catch(0),
  notes: z.string().trim().max(T.notes).nullable().default(null),
  muscleGroups: z.array(z.string().trim().max(T.muscleGroup)).max(T.muscleGroups).default([]),
  joined: z.boolean().default(false),
  load: z.string().trim().max(MAX_LOAD_LENGTH, `A load can be at most ${MAX_LOAD_LENGTH} characters.`).nullable().optional(),
});
const daySchema = z.object({
  id: z.number().int().positive().optional(),
  week: z.number().int().min(1).max(PROGRAM_LIMITS.maxDays).default(1),
  name: z.string().trim().max(T.dayName),
  instructions: z.string().trim().max(T.dayInstructions).nullable().default(null),
  exercises: z.array(exerciseSchema).max(PROGRAM_LIMITS.maxExercisesPerDay),
});
const programSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(1, "Give the program a title.").max(T.title),
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
export type BuildStartResult = { ok: true; jobId: string } | { ok: false; error: string };
export type BuildPollResult = { status: "running" } | BuildFromUploadResult;

const BUILD_FAILED = "I couldn't build the program just now. Try again in a moment.";

/** The signed-in user and their business, for binding and reading a build job. */
async function jobOwner(): Promise<{ tenantId: number; userId: number } | null> {
  const user = await requireUser();
  const tenantId = getCurrentMembership()?.tenant.id;
  return tenantId ? { tenantId, userId: user.id } : null;
}

/**
 * "Build from this file", step 1: checks the program, then starts Adonis
 * reading its spreadsheet detached on the server (a sheet can take several
 * minutes, longer than one request may last behind a proxy) and returns the
 * job id at once. Nothing is saved; the operator checks the program in the
 * builder and saves it there.
 */
export async function startBuildFromUploadAction(programId: number): Promise<BuildStartResult> {
  const owner = await jobOwner();
  if (!owner) return { ok: false, error: BUILD_FAILED };
  const p = idSchema.safeParse(programId);
  if (!p.success) return { ok: false, error: "I can't find that program." };
  const program = getProgram(p.data);
  if (!program) return { ok: false, error: "I can't find that program." };
  if (program.type !== "upload") return { ok: false, error: "Only an uploaded program can be built from its file." };
  const jobId = startJob<BuildFromUploadResult>(
    owner,
    async () => {
      const result = await importProgramFromUpload(p.data);
      return result.ok ? { ok: true, program: result.program, unplaced: result.unplaced } : { ok: false, error: result.error };
    },
    (err) => {
      console.error("[workout-import] build job failed:", err);
      return { ok: false, error: BUILD_FAILED };
    },
  );
  return { ok: true, jobId };
}

/** Step 2, polled: still running, or the result. Only the business and user that started the job can read it. */
export async function pollBuildFromUploadAction(jobId: string): Promise<BuildPollResult> {
  const owner = await jobOwner();
  if (!owner) return { ok: false, error: BUILD_FAILED };
  const state = readJob<BuildFromUploadResult>(String(jobId ?? ""), owner);
  if (!state) return { ok: false, error: "That build has stopped. Try again." };
  return state.status === "running" ? { status: "running" } : state.result;
}
