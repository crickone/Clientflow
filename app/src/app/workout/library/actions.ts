// app/src/app/workout/library/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { setHidden } from "@/lib/programs/library";
import { currentStaffActor } from "@/lib/programs/staffActor";

type Result = { ok: true } | { ok: false; error: string };
const OFF = { ok: false as const, error: "Programs aren't switched on for this business." };

/** Hide a platform program from this gym's members, or show it again. */
export async function setHiddenAction(key: string, hidden: boolean): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z.object({ key: z.string().min(1).max(80), hidden: z.boolean() }).safeParse({ key, hidden });
  if (!p.success || !setHidden(p.data.key, p.data.hidden, actor.userId)) return { ok: false, error: "That program isn't in the library." };
  revalidatePath("/workout/library");
  return { ok: true };
}
