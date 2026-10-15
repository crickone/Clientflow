"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { assignedWorkoutProgramDetail, clientMembership } from "@/lib/clientApp";
import { bookClient, removeBooking } from "@/lib/timetable";
import { setScanConsent } from "@/lib/inbody/scans";
import { bodyForGoal, clearGoal, setGoal, setManualBody } from "@/lib/goals";
import { isActivityKey, isGoalKey, parseManualBody } from "@/lib/goalsModel";
import {
  addSessionExercise,
  deleteSession,
  exerciseHistory,
  finishSession,
  getSession,
  listSessions,
  removeSessionExercise,
  saveSessionSets,
  startFreeSession,
  startSession,
  type StartResult,
} from "@/lib/workoutLog";
import { listExercises } from "@/lib/exerciseLibrary";
import { setTrainingPlan } from "@/lib/trainingOverview";
import { addMealItem, deleteMeal, getMealName, logMeal, removeMealItem, setMealItemGrams, setMealServings, updateMeal } from "@/lib/meals";
import { priceItem } from "@/lib/ai/priceItem";
import { AiCapError } from "@/lib/ai/usage";
import type { LoggedSet, SessionExercise } from "@/lib/workoutLogModel";
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

// ---- Goal from the InBody scan ---------------------------------------------

export async function setGoalAction(goal: string, activity: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { clientId } = requireClient();
  if (!isGoalKey(goal) || !isActivityKey(activity)) return { ok: false, error: "Pick a goal and how often you train." };
  if (!bodyForGoal(clientId)) return { ok: false, error: "Enter your numbers or get an InBody scan first." };
  setGoal(clientId, goal, activity);
  for (const p of ["/app/goal", "/app/nutrition", "/app/body", "/app"]) revalidatePath(p);
  return { ok: true };
}

export async function setBodyAction(input: { weightKg: string; heightCm: string; age: string; sex: string; pbf: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { clientId } = requireClient();
  const p = parseManualBody(input);
  if (!p.ok) return p;
  setManualBody(clientId, p.body);
  for (const p of ["/app/goal", "/app/nutrition", "/app/body", "/app"]) revalidatePath(p);
  return { ok: true };
}

export async function clearGoalAction(): Promise<{ ok: true }> {
  const { clientId } = requireClient();
  clearGoal(clientId);
  for (const p of ["/app/goal", "/app/nutrition", "/app/body", "/app"]) revalidatePath(p);
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

export async function startOwnWorkoutAction(): Promise<StartResult> {
  const { clientId } = requireClient();
  const r = startFreeSession(clientId);
  revalidatePath("/app/workouts");
  return r;
}

export interface ExerciseHit {
  exerciseId: number | null;
  name: string;
  detail: string | null;
}

/**
 * Exercises for the member's add-exercise search: the gym's library by name,
 * or with no search, the ones they've logged lately.
 */
export async function searchExercisesAction(query: string): Promise<ExerciseHit[]> {
  const { clientId } = requireClient();
  const q = String(query ?? "").trim().toLowerCase().slice(0, 60);
  if (!q) {
    const seen = new Map<string, ExerciseHit>();
    for (const s of listSessions(clientId, 15)) {
      for (const e of s.exercises) {
        if (e.section !== "workout" || seen.has(e.exerciseKey)) continue;
        const id = e.exerciseKey.startsWith("lib:") ? Number(e.exerciseKey.slice(4)) : null;
        seen.set(e.exerciseKey, { exerciseId: id, name: e.name, detail: "Done before" });
      }
    }
    return [...seen.values()].slice(0, 25);
  }
  const words = q.split(/\s+/);
  return listExercises()
    .filter((e) => words.every((w) => e.name.toLowerCase().includes(w)))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length)
    .slice(0, 25)
    .map((e) => ({ exerciseId: e.id, name: e.name, detail: e.muscleGroups.slice(0, 3).join(", ") || e.category }));
}

export async function addWorkoutExerciseAction(
  sessionId: number,
  exercise: { exerciseId: number | null; name: string },
): Promise<{ ok: true; exercise: SessionExercise; previous: LoggedSet[]; previousAt: number | null } | { ok: false; error: string }> {
  const { clientId } = requireClient();
  const id = idSchema.safeParse(sessionId);
  const ex = z.object({ exerciseId: z.number().int().positive().nullable(), name: z.string().trim().min(1).max(120) }).safeParse(exercise);
  if (!id.success || !ex.success) return { ok: false, error: "Couldn't add that exercise." };
  // A library id must be a real exercise in this gym's library; the name comes from the library, not the request.
  let name = ex.data.name;
  if (ex.data.exerciseId !== null) {
    const lib = listExercises().find((e) => e.id === ex.data.exerciseId);
    if (!lib) return { ok: false, error: "That exercise isn't in the library." };
    name = lib.name;
  }
  const added = addSessionExercise(clientId, id.data, { exerciseId: ex.data.exerciseId, name });
  if (!added) return { ok: false, error: "Couldn't add that exercise." };
  const { previous, previousAt } = exerciseHistory(clientId, [added.exerciseKey], id.data);
  return { ok: true, exercise: added, previous: previous[added.exerciseKey] ?? [], previousAt: previousAt[added.exerciseKey] ?? null };
}

export async function removeWorkoutExerciseAction(sessionId: number, sessionExerciseId: number): Promise<{ ok: boolean }> {
  const { clientId } = requireClient();
  const a = idSchema.safeParse(sessionId);
  const b = idSchema.safeParse(sessionExerciseId);
  if (!a.success || !b.success) return { ok: false };
  return { ok: removeSessionExercise(clientId, a.data, b.data) };
}

export async function saveTrainingDaysAction(programId: number, weekdays: number[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const { clientId } = requireClient();
  const p = idSchema.safeParse(programId);
  const d = z.array(z.number().int().min(1).max(7)).max(7).safeParse(weekdays);
  if (!p.success || !d.success) return { ok: false, error: "Couldn't save your training days." };
  if (!assignedWorkoutProgramDetail(clientId, p.data)) return { ok: false, error: "That programme isn't assigned to you." };
  setTrainingPlan(clientId, p.data, d.data);
  revalidatePath("/app/workouts");
  revalidatePath("/app");
  return { ok: true };
}

// ── meals ──────────────────────────────────────────────────────────────────────

const mealFields = z.object({
  // Meals are numbered M1, M2, M3 in the app; the name is what it was, and optional.
  name: z.string().trim().max(80).transform((v) => v || "Meal"),
  calories: z.coerce.number().min(0).max(10000),
  protein: z.coerce.number().min(0).max(1000).default(0),
  carbs: z.coerce.number().min(0).max(1000).default(0),
  fat: z.coerce.number().min(0).max(1000).default(0),
});
type MealResult = { ok: true } | { ok: false; error: string };

/** A meal typed in by hand (no photo). */
export async function addMealAction(input: unknown): Promise<MealResult> {
  const { clientId } = requireClient();
  const p = mealFields.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the numbers." };
  logMeal(clientId, { manual: p.data });
  revalidatePath("/app/nutrition");
  revalidatePath("/app");
  return { ok: true };
}

/** Correct a logged meal's name or numbers (the AI's read is an estimate). */
export async function updateMealAction(id: number, input: unknown): Promise<MealResult> {
  const { clientId } = requireClient();
  const i = idSchema.safeParse(id);
  const p = mealFields.safeParse(input);
  if (!i.success) return { ok: false, error: "Meal not found." };
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the numbers." };
  if (!updateMeal(clientId, i.data, p.data)) return { ok: false, error: "Meal not found." };
  revalidatePath("/app/nutrition");
  revalidatePath("/app");
  return { ok: true };
}

export async function setMealServingsAction(id: number, servings: number): Promise<MealResult> {
  const { clientId } = requireClient();
  const i = idSchema.safeParse(id);
  const s = z.coerce.number().min(0.25).max(20).safeParse(servings);
  if (!i.success || !s.success) return { ok: false, error: "Pick between a quarter and 20 servings." };
  if (!setMealServings(clientId, i.data, s.data)) return { ok: false, error: "Only a label meal has servings." };
  revalidatePath("/app/nutrition");
  revalidatePath("/app");
  return { ok: true };
}

export async function deleteMealAction(id: number): Promise<MealResult> {
  const { clientId } = requireClient();
  const i = idSchema.safeParse(id);
  if (!i.success || !deleteMeal(clientId, i.data)) return { ok: false, error: "Meal not found." };
  revalidatePath("/app/nutrition");
  revalidatePath("/app");
  return { ok: true };
}

/** Something the photo reader missed: priced from the client's words and added to the meal. */
export async function addMealItemAction(id: number, text: string): Promise<MealResult> {
  const { clientId, tenantId } = requireClient();
  const i = idSchema.safeParse(id);
  const t = z.string().trim().min(2, "Say what it was.").max(200).safeParse(text);
  if (!i.success) return { ok: false, error: "Meal not found." };
  if (!t.success) return { ok: false, error: t.error.issues[0]?.message ?? "Say what it was." };
  const meal = getMealName(clientId, i.data);
  if (meal === null) return { ok: false, error: "Meal not found." };
  let item;
  try {
    item = await priceItem({ tenantId, text: t.data, mealName: meal });
  } catch (err) {
    if (err instanceof AiCapError) return { ok: false, error: "Adding by description is paused on this account for now." };
    return { ok: false, error: "Couldn't work that out. Try again in a moment." };
  }
  if (!item) return { ok: false, error: "That doesn't read as food. Try naming the food and roughly how much." };
  if (!addMealItem(clientId, i.data, item)) return { ok: false, error: "Meal not found." };
  revalidatePath("/app/nutrition");
  revalidatePath("/app");
  return { ok: true };
}

export async function removeMealItemAction(id: number, index: number): Promise<MealResult> {
  const { clientId } = requireClient();
  const i = idSchema.safeParse(id);
  const n = z.coerce.number().int().min(0).safeParse(index);
  if (!i.success || !n.success || !removeMealItem(clientId, i.data, n.data)) return { ok: false, error: "That item isn't on the meal." };
  revalidatePath("/app/nutrition");
  revalidatePath("/app");
  return { ok: true };
}

export async function setMealItemGramsAction(id: number, index: number, grams: number): Promise<MealResult> {
  const { clientId } = requireClient();
  const i = idSchema.safeParse(id);
  const n = z.coerce.number().int().min(0).safeParse(index);
  const g = z.coerce.number().min(1).max(5000).safeParse(grams);
  if (!i.success || !n.success) return { ok: false, error: "That item isn't on the meal." };
  if (!g.success) return { ok: false, error: "Enter the weight in grams, from 1 to 5000." };
  if (!setMealItemGrams(clientId, i.data, n.data, g.data)) return { ok: false, error: "That item has no weight to change. Remove it and add it again with the amount." };
  revalidatePath("/app/nutrition");
  revalidatePath("/app");
  return { ok: true };
}
