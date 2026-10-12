"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { assignedWorkoutProgramDetail, clientMembership } from "@/lib/clientApp";
import { bookClient, removeBooking } from "@/lib/timetable";
import { setScanConsent } from "@/lib/inbody/scans";
import { deleteSession, exerciseHistory, finishSession, getSession, saveSessionSets, startSession, type StartResult } from "@/lib/workoutLog";
import { personalBests } from "@/lib/workoutLogModel";

export type BookResult = { ok: true } | { ok: false; error: string };

const idSchema = z.coerce.number().int().positive();

export async function bookClassAction(sessionId: number): Promise<BookResult> {
  const { clientId } = requireClient();
  const p = idSchema.safeParse(sessionId);
  if (!p.success) return { ok: false, error: "Invalid class." };
  // An active membership is required to book.
  if (!clientMembership(clientId)) {
    return { ok: false, error: "You need an active membership to book classes." };
  }
  const res = bookClient(p.data, clientId);
  revalidatePath("/app/timetable");
  revalidatePath("/app");
  return res;
}

export async function cancelClassAction(sessionId: number): Promise<BookResult> {
  const { clientId } = requireClient();
  const p = idSchema.safeParse(sessionId);
  if (!p.success) return { ok: false, error: "Invalid class." };
  removeBooking(p.data, clientId);
  revalidatePath("/app/timetable");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * The member's own choice to see their InBody scans in the app, and to stop.
 * Their tenant comes from their client session; nothing here takes an id.
 */
export async function setBodyScanConsentAction(consent: boolean): Promise<{ ok: true }> {
  const { clientId } = requireClient();
  setScanConsent(clientId, consent === true);
  revalidatePath("/app/body");
  revalidatePath("/app");
  return { ok: true };
}

// ---- Workout log -----------------------------------------------------------
// The member logs their own lifts. Every action takes the member from their
// client session and passes it down; lib/workoutLog checks each session id
// against it, so an id from another member's log does nothing.

const setSchema = z.object({
  weightKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(1).max(999).nullable(),
  done: z.boolean(),
});
const exercisesSchema = z.array(z.object({ id: z.number().int().positive(), sets: z.array(setSchema).max(20) })).max(60);

export async function startWorkoutAction(programId: number, dayPosition: number): Promise<StartResult> {
  const { clientId } = requireClient();
  const p = idSchema.safeParse(programId);
  const d = z.number().int().min(0).max(100).safeParse(dayPosition);
  if (!p.success || !d.success) return { ok: false, error: "That day isn't in your programme." };
  const program = assignedWorkoutProgramDetail(clientId, p.data);
  if (!program) return { ok: false, error: "That programme isn't assigned to you." };
  const r = startSession(clientId, program, d.data);
  revalidatePath("/app/workouts");
  return r;
}

export async function saveWorkoutAction(sessionId: number, exercises: unknown): Promise<{ ok: boolean }> {
  const { clientId } = requireClient();
  const id = idSchema.safeParse(sessionId);
  const ex = exercisesSchema.safeParse(exercises);
  if (!id.success || !ex.success) return { ok: false };
  return { ok: saveSessionSets(clientId, id.data, ex.data) };
}

export type FinishResult = { ok: true; bests: { name: string; weightKg: number; reps: number }[] } | { ok: false; error: string };

export async function finishWorkoutAction(sessionId: number, exercises: unknown): Promise<FinishResult> {
  const { clientId } = requireClient();
  const id = idSchema.safeParse(sessionId);
  const ex = exercisesSchema.safeParse(exercises);
  if (!id.success || !ex.success) return { ok: false, error: "Couldn't save this workout." };
  if (!saveSessionSets(clientId, id.data, ex.data)) return { ok: false, error: "Workout not found." };
  const session = getSession(clientId, id.data);
  if (!session) return { ok: false, error: "Workout not found." };
  const { best } = exerciseHistory(clientId, session.exercises.map((e) => e.exerciseKey), session.id);
  finishSession(clientId, session.id);
  revalidatePath("/app/workouts");
  revalidatePath("/app");
  return { ok: true, bests: personalBests(session.exercises, best) };
}

export async function discardWorkoutAction(sessionId: number): Promise<{ ok: boolean }> {
  const { clientId } = requireClient();
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return { ok: false };
  const ok = deleteSession(clientId, id.data);
  revalidatePath("/app/workouts");
  revalidatePath("/app");
  return { ok };
}
