"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  deleteExercise,
  ExerciseOwnershipError,
  listExercises,
  saveExercise,
  selectExercisesNeedingVideo,
  setExerciseVideoUrl,
  type ExerciseLibInput,
} from "@/lib/exerciseLibrary";
import { searchExerciseVideo } from "@/lib/youtube";

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
  // saveExercise() throws ExerciseOwnershipError when `id` names a GLOBAL row
  // (tenant_id IS NULL) or another tenant's custom — e.g. a crafted/direct
  // POST trying to edit a shared library exercise. Map that to a normal
  // ExerciseResult instead of letting it 500; anything else is unexpected
  // and should still surface as a real error.
  let id: number;
  try {
    id = saveExercise(parsed.data as ExerciseLibInput);
  } catch (err) {
    if (err instanceof ExerciseOwnershipError) {
      return { ok: false, error: "That's a shared library exercise — you can only edit your own custom exercises." };
    }
    throw err;
  }
  revalidatePath("/workout/exercises");
  revalidatePath("/workout");
  return { ok: true, id };
}

export type FindVideoResult =
  | { ok: true; url: string; title: string; channel: string }
  | { ok: false; error: string };

/** Auto-find a YouTube "how to" demo for an exercise name (needs YOUTUBE_API_KEY). */
export async function findExerciseVideoAction(name: string): Promise<FindVideoResult> {
  await requireUser();
  const parsed = z.string().trim().min(1).max(200).safeParse(name);
  if (!parsed.success) return { ok: false, error: "Enter an exercise name first." };
  if (!process.env.YOUTUBE_API_KEY) {
    return { ok: false, error: "YouTube auto-find isn't set up yet — paste a link, or add a YOUTUBE_API_KEY to enable it." };
  }
  const hit = await searchExerciseVideo(parsed.data);
  if (!hit) return { ok: false, error: "No video found — try a more specific name, or paste a link." };
  return { ok: true, url: hit.url, title: hit.title, channel: hit.channel };
}

export type BulkVideoResult =
  | { ok: true; found: number; missingBefore: number; remaining: number }
  | { ok: false; error: string };

// Cap per run to stay well inside the free YouTube quota (each search ≈ 100 units
// of the 10,000/day allowance) and to keep the request within its time budget.
const BULK_MAX_PER_RUN = 40;

/**
 * Auto-find + attach a YouTube video for every exercise missing one in the
 * CURRENT tenant's view (global rows + this tenant's own customs).
 * listExercises()/setExerciseVideoUrl() already read/write the control-plane
 * exercise_library table (GEL Task 2), so this action already operates on
 * the shared library; GEL Task 3 only swapped the inline "missing" filter
 * for the shared selectExercisesNeedingVideo() helper, so this and the
 * nightly single-pass backfill (lib/automations/scheduler.ts) agree on one
 * tested definition of "missing". Same requireUser() gate as today — the
 * tenant-vs-global write guard added in GEL Task 5 (catching
 * ExerciseOwnershipError) is saveExerciseAction/deleteExerciseAction's
 * concern, not this one (it only ever fills a blank video_url, never
 * edits/deletes a row).
 */
export async function bulkFindExerciseVideosAction(): Promise<BulkVideoResult> {
  await requireUser();
  if (!process.env.YOUTUBE_API_KEY) {
    return { ok: false, error: "YouTube auto-find isn't set up yet — add a YOUTUBE_API_KEY to enable it." };
  }
  const missing = selectExercisesNeedingVideo(listExercises());
  const batch = missing.slice(0, BULK_MAX_PER_RUN);
  let found = 0;
  for (const ex of batch) {
    const hit = await searchExerciseVideo(ex.name);
    if (hit) {
      setExerciseVideoUrl(ex.id, hit.url);
      found++;
    }
  }
  revalidatePath("/workout/exercises");
  revalidatePath("/workout");
  return { ok: true, found, missingBefore: missing.length, remaining: missing.length - found };
}

export async function deleteExerciseAction(id: number) {
  await requireUser();
  const p = z.coerce.number().int().positive().safeParse(id);
  if (!p.success) return;
  // Same ownership guard as saveExerciseAction above: deleteExercise() throws
  // ExerciseOwnershipError for a GLOBAL row or another tenant's custom. Treat
  // that as a no-op (the row is left untouched, same as an unknown id) rather
  // than a 500 — anything else still throws.
  try {
    deleteExercise(p.data);
  } catch (err) {
    if (err instanceof ExerciseOwnershipError) return;
    throw err;
  }
  revalidatePath("/workout/exercises");
}
