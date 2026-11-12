"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { coachMoveToWeek, coachSetMax, getEnrolmentFor, setTrainingMode } from "@/lib/programs/enrolments";
import { unitToKg } from "@/lib/programs/units";
import { currentStaffActor } from "@/lib/programs/staffActor";

type Result = { ok: true } | { ok: false; error: string };

/** paused: switching to coach guided paused a live program. resumed: switching to DIY restarted a paused one. */
export async function setTrainingModeAction(clientId: number, mode: string): Promise<{ ok: true; paused: boolean; resumed: boolean } | { ok: false; error: string }> {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false, error: "Programs aren't switched on for this business." };
  const id = z.number().int().positive().safeParse(clientId);
  const m = z.enum(["coach", "diy"]).safeParse(mode);
  if (!id.success || !m.success) return { ok: false, error: "That change doesn't make sense." };
  const r = setTrainingMode(id.data, m.data, actor);
  if (!r) return { ok: false, error: "Member not found." };
  revalidatePath(`/clients/${id.data}`);
  return { ok: true, ...r };
}

const OFF = { ok: false as const, error: "Programs aren't switched on for this business." };
const idZ = z.number().int().positive();

/** Correct a member's max. The value is in the member's unit; the change is logged with the coach's name. */
export async function coachSetMaxAction(clientId: number, enrolmentId: number, lift: string, value: number): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z
    .object({ clientId: idZ, enrolmentId: idZ, lift: z.enum(["squat", "bench", "deadlift", "press", "row"]), value: z.number().positive().max(1500) })
    .safeParse({ clientId, enrolmentId, lift, value });
  if (!p.success) return { ok: false, error: "Enter a max to save." };
  const view = getEnrolmentFor(p.data.clientId, p.data.enrolmentId);
  if (!view) return { ok: false, error: "That program has ended." };
  const r = coachSetMax(p.data.clientId, p.data.enrolmentId, p.data.lift, unitToKg(p.data.value, view.unit), actor);
  if (r.ok) revalidatePath(`/clients/${p.data.clientId}`);
  return r;
}

/** Move a member to the start of another week of their program (0-based). Logged with the coach's name. */
export async function coachMoveWeekAction(clientId: number, enrolmentId: number, weekIndex: number): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z.object({ clientId: idZ, enrolmentId: idZ, weekIndex: z.number().int().min(0).max(51) }).safeParse({ clientId, enrolmentId, weekIndex });
  if (!p.success) return { ok: false, error: "That week isn't in the program." };
  const r = coachMoveToWeek(p.data.clientId, p.data.enrolmentId, p.data.weekIndex, actor);
  if (r.ok) revalidatePath(`/clients/${p.data.clientId}`);
  return r;
}
