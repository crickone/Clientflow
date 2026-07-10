"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  bookClient,
  createOneOffSession,
  createRecurringClass,
  deleteSession,
  removeBooking,
  setBookingStatus,
  setSessionStatus,
  updateSession,
  weekStartMonday,
  type SessionFields,
} from "@/lib/timetable";

const HHMM = /^\d{2}:\d{2}$/;
const ISODATE = /^\d{4}-\d{2}-\d{2}$/;

const fieldsSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#3b82f6"),
  capacity: z.coerce.number().int().min(1).max(500),
  location: z.string().trim().max(160).optional().nullable(),
  instructor: z.string().trim().max(120).optional().nullable(),
  visibility: z.enum(["public", "clients", "private"]).default("public"),
});

const createSchema = z
  .object({
    startTime: z.string().regex(HHMM),
    durationMin: z.coerce.number().int().min(5).max(600),
    repeat: z.coerce.boolean().default(false),
    date: z.string().regex(ISODATE).optional(),
    daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).optional(),
    startDate: z.string().regex(ISODATE).optional(),
    endDate: z.string().regex(ISODATE).optional().nullable(),
    weekStart: z.string().regex(ISODATE).optional(),
  })
  .and(fieldsSchema);

export type CreateClassResult = { ok: true } | { ok: false; error: string };

export async function createClassAction(
  raw: unknown,
): Promise<CreateClassResult> {
  await requireUser();
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;
  const fields: SessionFields = {
    name: v.name,
    description: v.description ?? null,
    category: v.category ?? null,
    color: v.color,
    capacity: v.capacity,
    location: v.location ?? null,
    instructor: v.instructor ?? null,
    visibility: v.visibility,
  };

  if (v.repeat) {
    const days = (v.daysOfWeek ?? []).filter((n, i, a) => a.indexOf(n) === i);
    if (days.length === 0) {
      return { ok: false, error: "Pick at least one day of the week to repeat on." };
    }
    const startDate = v.startDate ?? v.date;
    if (!startDate) return { ok: false, error: "A start date is required." };
    createRecurringClass({
      fields,
      daysOfWeek: days,
      startTime: v.startTime,
      durationMin: v.durationMin,
      startDate,
      endDate: v.endDate ?? null,
      materializeFrom: v.weekStart ?? weekStartMonday(startDate),
    });
  } else {
    const date = v.date ?? v.startDate;
    if (!date) return { ok: false, error: "A date is required." };
    createOneOffSession({
      fields,
      date,
      startTime: v.startTime,
      durationMin: v.durationMin,
    });
  }

  revalidatePath("/timetable");
  return { ok: true };
}

const editSchema = z
  .object({
    date: z.string().regex(ISODATE),
    startTime: z.string().regex(HHMM),
    durationMin: z.coerce.number().int().min(5).max(600),
  })
  .and(fieldsSchema);

export async function updateSessionAction(
  id: number,
  raw: unknown,
): Promise<CreateClassResult> {
  await requireUser();
  const sid = z.coerce.number().int().positive().safeParse(id);
  const parsed = editSchema.safeParse(raw);
  if (!sid.success || !parsed.success) {
    return { ok: false, error: parsed.success ? "Invalid id." : parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;
  updateSession(sid.data, {
    fields: {
      name: v.name,
      description: v.description ?? null,
      category: v.category ?? null,
      color: v.color,
      capacity: v.capacity,
      location: v.location ?? null,
      instructor: v.instructor ?? null,
      visibility: v.visibility,
    },
    date: v.date,
    startTime: v.startTime,
    durationMin: v.durationMin,
  });
  revalidatePath("/timetable");
  return { ok: true };
}

const idSchema = z.coerce.number().int().positive();

export async function markAttendanceAction(
  bookingId: number,
  status: "booked" | "attended" | "no_show",
) {
  await requireUser();
  const st = z.enum(["booked", "attended", "no_show"]).safeParse(status);
  if (!st.success) return;
  setBookingStatus(idSchema.parse(bookingId), st.data);
  revalidatePath("/timetable");
}

export async function bookAction(
  sessionId: number,
  clientId: number,
): Promise<CreateClassResult> {
  await requireUser();
  const sid = idSchema.safeParse(sessionId);
  const cid = idSchema.safeParse(clientId);
  if (!sid.success || !cid.success) return { ok: false, error: "Invalid ids." };
  const res = bookClient(sid.data, cid.data);
  revalidatePath("/timetable");
  return res;
}

export async function unbookAction(sessionId: number, clientId: number) {
  await requireUser();
  removeBooking(idSchema.parse(sessionId), idSchema.parse(clientId));
  revalidatePath("/timetable");
}

export async function cancelSessionAction(sessionId: number, cancel: boolean) {
  await requireUser();
  setSessionStatus(idSchema.parse(sessionId), cancel ? "cancelled" : "scheduled");
  revalidatePath("/timetable");
}

export async function deleteSessionAction(sessionId: number) {
  await requireUser();
  deleteSession(idSchema.parse(sessionId));
  revalidatePath("/timetable");
}
