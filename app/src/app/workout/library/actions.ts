// app/src/app/workout/library/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { deleteCopy, makeCopy, saveCopy, setHidden } from "@/lib/programs/library";
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

const idZ = z.number().int().positive();

/** "Make our version": copy a platform program into this gym's own library. */
export async function makeCopyAction(key: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const k = z.string().min(1).max(80).safeParse(key);
  const id = k.success ? makeCopy(k.data, actor.userId) : null;
  if (!id) return { ok: false, error: "That program isn't in the library." };
  revalidatePath("/workout/library");
  return { ok: true, id };
}

/** Save the editor. Refused, with the reasons, if it breaks the template check or drops a lift the engine needs. */
export async function saveCopyAction(id: number, template: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false, errors: [OFF.error] };
  const i = idZ.safeParse(id);
  if (!i.success) return { ok: false, errors: ["That version no longer exists."] };
  const r = saveCopy(i.data, template);
  if (r.ok) {
    revalidatePath("/workout/library");
    revalidatePath(`/workout/library/copies/${i.data}`);
  }
  return r;
}

/** Delete a gym version. Members already running it keep their own snapshot. */
export async function deleteCopyAction(id: number): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const i = idZ.safeParse(id);
  if (!i.success || !deleteCopy(i.data)) return { ok: false, error: "That version no longer exists." };
  revalidatePath("/workout/library");
  return { ok: true };
}
