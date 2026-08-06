"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteExercise, listExercises, saveExercise, setExerciseVideoUrl, type ExerciseLibInput } from "@/lib/exerciseLibrary";
import { parseYouTubeId, searchExerciseVideo } from "@/lib/youtube";

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

/** Auto-find + attach a YouTube video for every exercise that doesn't have one. */
export async function bulkFindExerciseVideosAction(): Promise<BulkVideoResult> {
  await requireUser();
  if (!process.env.YOUTUBE_API_KEY) {
    return { ok: false, error: "YouTube auto-find isn't set up yet — add a YOUTUBE_API_KEY to enable it." };
  }
  const missing = listExercises().filter((e) => !parseYouTubeId(e.videoUrl));
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
  deleteExercise(p.data);
  revalidatePath("/workout/exercises");
}
