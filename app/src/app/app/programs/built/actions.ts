// app/src/app/app/programs/built/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { memberSeesPrograms } from "@/lib/programs/access";
import { createMemberProgram, deleteMemberProgram, parseStartFrom, saveMemberProgram, startingDraft } from "@/lib/programs/memberPrograms";

// The member's own programs. Every action takes the member from their client
// session; lib/programs/memberPrograms only ever touches that member's rows.

type SaveResult = { ok: true; id: number; edited: boolean } | { ok: false; errors: string[] };
const OFF = "Programs aren't switched on for you.";

function member() {
  const c = requireClient();
  return memberSeesPrograms(c) ? c : null;
}

function refresh(id?: number) {
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
  if (id) revalidatePath(`/app/programs/built/${id}`);
}

const saveZ = z.object({
  id: z.number().int().positive().nullable(),
  /** Where a new program started from (the builder's ?from=); its maxes and based-on come from the server, never the request. */
  from: z.string().max(80).nullable(),
  template: z.unknown(),
  /** For each week, the saved week it came from (null for a new one); lets a running member stay on the same logical week. Required for an edit. */
  weekOrigins: z.array(z.number().int().min(0).max(11).nullable()).max(12).optional(),
});
const UNREADABLE = "Couldn't read the program. Reload the page and try again.";

/** Save a new program, or an edit to one. An edit to the running program applies from the next session. */
export async function saveBuiltProgramAction(raw: unknown): Promise<SaveResult> {
  const c = member();
  if (!c) return { ok: false, errors: [OFF] };
  const p = saveZ.safeParse(raw);
  if (!p.success) return { ok: false, errors: [UNREADABLE] };
  const v = p.data;
  // A new program has no origins; an edit must say where each week came from.
  if (v.id !== null && v.weekOrigins === undefined) return { ok: false, errors: [UNREADABLE] };
  if (v.id === null) {
    const from = parseStartFrom(v.from);
    const draft = from ? startingDraft(c.clientId, from) : null;
    const r = createMemberProgram(c.clientId, { template: v.template, maxes: draft?.maxes ?? {}, basedOn: draft?.basedOn ?? null });
    if (!r.ok) return { ok: false, errors: r.errors };
    refresh(r.id);
    return { ok: true, id: r.id, edited: false };
  }
  const r = saveMemberProgram(c.clientId, v.id, v.template, v.weekOrigins);
  if (!r.ok) return { ok: false, errors: r.errors };
  refresh(v.id);
  return { ok: true, id: v.id, edited: r.edited };
}

export async function deleteBuiltProgramAction(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = member();
  if (!c) return { ok: false, error: OFF };
  const p = z.number().int().positive().safeParse(id);
  if (!p.success) return { ok: false, error: "That program no longer exists." };
  const r = deleteMemberProgram(c.clientId, p.data);
  if (r.ok) refresh();
  return r;
}
