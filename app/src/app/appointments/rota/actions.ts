"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin, requireUser } from "@/lib/auth";
import { addDaysIso } from "@/lib/booking/slotModel";
import { isHm, isIsoDate } from "@/lib/scheduling/rotaModel";
import {
  addPerson,
  addShift,
  copyWeek,
  deleteShift,
  setRotaOn,
  setTherapyStaffing,
  shiftsBetween,
  updateShift,
} from "@/lib/scheduling/rotaRepo";

/**
 * The rota page's writes. User errors come back as `{ ok: false, error }`
 * (never thrown) so the page can show them; only a missing session or role
 * throws, from the auth guard.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.number().int().positive();
const isoDate = z.string().refine(isIsoDate);
const hm = z.string().refine(isHm);

const shiftInput = z.object({ staffId: id, date: isoDate, start: hm, end: hm });
const timesInput = z.object({ start: hm, end: hm });
const name = z.string().trim().min(1).max(120);
const staffing = z.enum(["whole", "setup"]);

const BAD_TIMES = "Give the times as HH:mm.";

/** The message for the field that failed, not a catch-all. */
function shiftInputError(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === "date") return "Give the date as YYYY-MM-DD.";
  if (field === "staffId") return "That person is not on the rota.";
  return BAD_TIMES;
}

/** The rota changes who can be booked, so the diary and the booking page read it too. */
function refresh() {
  revalidatePath("/appointments/rota");
  revalidatePath("/appointments");
  revalidatePath("/appointments/new");
}

export async function addShiftAction(input: { staffId: number; date: string; start: string; end: string }): Promise<ActionResult> {
  await requireUser();
  const parsed = shiftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: shiftInputError(parsed.error) };
  const res = addShift(parsed.data);
  if (!res.ok) return res;
  refresh();
  return { ok: true };
}

export async function updateShiftAction(shiftId: number, input: { start: string; end: string }): Promise<ActionResult> {
  await requireUser();
  const parsedId = id.safeParse(shiftId);
  if (!parsedId.success) return { ok: false, error: "That shift no longer exists." };
  const parsed = timesInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: BAD_TIMES };
  const res = updateShift(parsedId.data, parsed.data);
  if (!res.ok) return res;
  refresh();
  return { ok: true };
}

export async function deleteShiftAction(shiftId: number): Promise<ActionResult> {
  await requireUser();
  const parsed = id.safeParse(shiftId);
  if (!parsed.success) return { ok: false, error: "That shift no longer exists." };
  deleteShift(parsed.data);
  refresh();
  return { ok: true };
}

export async function copyLastWeekAction(monday: string): Promise<ActionResult> {
  await requireUser();
  const parsed = isoDate.safeParse(monday);
  if (!parsed.success) return { ok: false, error: "Give the week as YYYY-MM-DD." };
  const from = addDaysIso(parsed.data, -7);
  // Checked first: copyWeek clears the target week before copying, and an
  // empty source must not wipe this week's shifts.
  if (shiftsBetween(from, addDaysIso(from, 6)).length === 0) return { ok: false, error: "Last week has no shifts to copy." };
  const count = copyWeek(from, parsed.data);
  if (count === 0) return { ok: false, error: "None of last week's shifts fit this week's opening hours." };
  refresh();
  return { ok: true, message: count === 1 ? "Copied 1 shift." : `Copied ${count} shifts.` };
}

export async function addPersonAction(input: string): Promise<ActionResult> {
  await requireUser();
  const parsed = name.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the person a name, up to 120 characters." };
  const res = addPerson(parsed.data);
  if (!res.ok) return res;
  refresh();
  return { ok: true };
}

export async function setRotaOnAction(on: boolean): Promise<ActionResult> {
  await requireAdmin();
  const parsed = z.boolean().safeParse(on);
  if (!parsed.success) return { ok: false, error: "Could not change the setting." };
  setRotaOn(parsed.data);
  refresh();
  return { ok: true };
}

export async function setStaffingAction(therapyId: number, value: "whole" | "setup"): Promise<ActionResult> {
  await requireAdmin();
  const parsedId = id.safeParse(therapyId);
  const parsed = staffing.safeParse(value);
  if (!parsedId.success || !parsed.success) return { ok: false, error: "Could not change that treatment." };
  setTherapyStaffing(parsedId.data, parsed.data);
  refresh();
  return { ok: true };
}
