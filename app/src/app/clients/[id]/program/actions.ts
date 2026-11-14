"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkPersonCopy, coachAssign, coachEditProgram, coachEndProgram } from "@/lib/programs/coachPrograms";
import { programByKey } from "@/lib/programs/library";
import { currentStaffActor } from "@/lib/programs/staffActor";
import { resolveMaxes, startZ } from "@/lib/programs/startInput";
import { stepFromKey } from "@/lib/programs/units";
import { sendToClient } from "@/lib/push";

const OFF = { ok: false as const, error: "Programs aren't switched on for this business." };
const idZ = z.number().int().positive();

function refresh(clientId: number) {
  revalidatePath(`/clients/${clientId}`);
  for (const p of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(p);
}

/** Set a program for a member. replace: end the member's live program first (the coach confirmed). */
export async function coachAssignAction(clientId: number, raw: unknown, template: unknown | null, replace: boolean) {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const id = idZ.safeParse(clientId);
  const p = startZ.safeParse(raw);
  if (!id.success || !p.success) return { ok: false as const, error: "Check the entries and try again." };
  const v = p.data;
  if ((v.unit === "lb") !== (v.step === "5lb")) return { ok: false as const, error: "Pick a smallest jump in the same unit." };
  const maxes = resolveMaxes(id.data, v.unit, v.maxes);
  if (!maxes.ok) return maxes;
  const r = coachAssign(id.data, { key: v.key, template, maxesKg: maxes.kg, unit: v.unit, stepKg: stepFromKey(v.step), startDate: v.startDate, weekdays: v.weekdays, replace: replace === true }, actor);
  if (!r.ok) return { ok: false as const, error: r.error, ...(r.needsReplace ? { needsReplace: true as const } : {}) };
  refresh(id.data);
  const name = programByKey(v.key)?.template.name ?? "a program";
  // Best effort: a push failure never undoes the assignment.
  void sendToClient(id.data, { title: "New program", body: `Your coach set you a program: ${name}.`, url: "/app/programs/mine" }).catch((err) => console.error("[programs] assign push failed:", err));
  return { ok: true as const };
}

/** Check the coach's draft before the setup step, so errors show while they are still editing. */
export async function checkDraftAction(clientId: number, key: string, template: unknown) {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false as const, errors: [OFF.error] };
  if (!idZ.safeParse(clientId).success) return { ok: false as const, errors: ["Member not found."] };
  const entry = programByKey(String(key));
  if (!entry) return { ok: false as const, errors: ["That program isn't available."] };
  const r = checkPersonCopy(entry.template, template);
  return r.ok ? { ok: true as const } : r;
}

export async function coachEditProgramAction(clientId: number, enrolmentId: number, template: unknown, weekOrigins: unknown) {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false as const, errors: [OFF.error] };
  const p = z.object({ clientId: idZ, enrolmentId: idZ }).safeParse({ clientId, enrolmentId });
  if (!p.success) return { ok: false as const, errors: ["That program has ended."] };
  const r = coachEditProgram(p.data.clientId, p.data.enrolmentId, template, weekOrigins, actor);
  if (r.ok) refresh(p.data.clientId);
  return r;
}

export async function coachEndProgramAction(clientId: number, enrolmentId: number) {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z.object({ clientId: idZ, enrolmentId: idZ }).safeParse({ clientId, enrolmentId });
  if (!p.success) return { ok: false as const, error: "That program has ended." };
  const r = coachEndProgram(p.data.clientId, p.data.enrolmentId, actor);
  if (r.ok) refresh(p.data.clientId);
  return r;
}
