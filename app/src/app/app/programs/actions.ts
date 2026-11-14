// app/src/app/app/programs/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { memberSeesPrograms } from "@/lib/programs/access";
import {
  endEnrolment,
  enrol,
  liveEnrolment,
  memberSetMax,
  restartFromTest,
  setEnrolmentDays,
  skipEnrolmentSession,
  startEnrolmentSession,
} from "@/lib/programs/enrolments";
import type { StartResult } from "@/lib/workoutLog";
import { programByKey } from "@/lib/programs/library";
import { enrolMemberProgram } from "@/lib/programs/memberPrograms";
import { parseMemberKey } from "@/lib/programs/memberTemplate";
import { stepFromKey } from "@/lib/programs/units";
import { maxEntryZ, resolveMaxes, startZ, type MaxEntry, type StartProgramInput } from "@/lib/programs/startInput";

// The member's own program. Every action takes the member from their client
// session; lib/programs/enrolments only ever touches that member's enrolment.

export type { MaxEntry, StartProgramInput };

type Result = { ok: true } | { ok: false; error: string };
const OFF = { ok: false as const, error: "Programs aren't switched on for you." };

function member() {
  const c = requireClient();
  return memberSeesPrograms(c) ? c : null;
}

export async function startProgramAction(raw: unknown): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const p = startZ.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues.find((i) => i.path[0] === "startDate")?.message ?? "Check your entries and try again." };
  const v = p.data;
  if ((v.unit === "lb") !== (v.step === "5lb")) return { ok: false, error: "Pick a smallest jump in the same unit." };
  // "member:<id>" is one of the member's own programs; the store checks it is theirs.
  const ownId = parseMemberKey(v.key);
  if (ownId === null && !programByKey(v.key)) return { ok: false, error: "That program isn't available." };
  const maxes = resolveMaxes(c.clientId, v.unit, v.maxes);
  if (!maxes.ok) return maxes;
  const input = { maxesKg: maxes.kg, unit: v.unit, stepKg: stepFromKey(v.step), startDate: v.startDate, weekdays: v.weekdays };
  const r = ownId !== null ? enrolMemberProgram(c.clientId, ownId, input) : enrol(c.clientId, { key: v.key, ...input });
  if (!r.ok) return r;
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
  return { ok: true };
}

function refresh() {
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
}

/** Start (or continue) the next session of the member's program in the logger. */
export async function startProgramSessionAction(): Promise<StartResult> {
  const c = member();
  if (!c) return OFF;
  const r = startEnrolmentSession(c.clientId);
  refresh();
  return r;
}

export async function skipProgramSessionAction(): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const r = skipEnrolmentSession(c.clientId);
  refresh();
  return r;
}

export async function endProgramAction(): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  if (!endEnrolment(c.clientId, { kind: "member" })) return { ok: false, error: "You don't have a program running." };
  refresh();
  return { ok: true };
}

export async function setProgramDaysAction(weekdays: number[]): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const d = z.array(z.number().int().min(1).max(7)).max(7).safeParse(weekdays);
  if (!d.success) return { ok: false, error: "Couldn't save your training days." };
  if (!setEnrolmentDays(c.clientId, d.data)) return { ok: false, error: "You don't have a program running." };
  refresh();
  return { ok: true };
}

/** A finished block: start it again from the member's new maxes (in their unit). */
export async function restartProgramAction(raw: unknown): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const p = z.object({ maxes: z.array(maxEntryZ).max(5) }).safeParse(raw);
  if (!p.success) return { ok: false, error: "Check your entries and try again." };
  const view = liveEnrolment(c.clientId);
  if (!view) return { ok: false, error: "You don't have a program running." };
  const maxes = resolveMaxes(c.clientId, view.unit, p.data.maxes);
  if (!maxes.ok) return maxes;
  const r = restartFromTest(c.clientId, maxes.kg);
  refresh();
  return r;
}

/** A max on the member's own running program (in their unit). */
export async function setOwnMaxAction(raw: unknown): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const p = z.object({ max: maxEntryZ }).safeParse(raw);
  if (!p.success) return { ok: false, error: "Check your entry and try again." };
  const view = liveEnrolment(c.clientId);
  if (!view) return { ok: false, error: "You don't have a program running." };
  // Only a program the member built takes a max here; library programs set theirs at start or after a test.
  if (!view.programKey || parseMemberKey(view.programKey) === null) return { ok: false, error: "You don't have a program of your own running." };
  const maxes = resolveMaxes(c.clientId, view.unit, [p.data.max]);
  if (!maxes.ok) return maxes;
  const kg = maxes.kg[p.data.max.lift];
  if (kg === undefined) return { ok: false, error: "Check your entry and try again." };
  const r = memberSetMax(c.clientId, p.data.max.lift, kg);
  refresh();
  return r;
}
