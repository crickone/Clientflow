"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createEvent, deleteEvent, updateEvent } from "@/lib/calendar";

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  allDay: z.boolean(),
  location: z.string().max(200).optional(),
  color: z.string().max(20).optional(),
});

export type ActionResult = { ok: true; id?: number } | { ok: false; error: string };

export async function saveEventAction(
  id: number | null,
  input: unknown,
): Promise<ActionResult> {
  const me = await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const data = {
    ...parsed.data,
    description: parsed.data.description ?? null,
    startTime: parsed.data.startTime || null,
    endTime: parsed.data.endTime || null,
    location: parsed.data.location ?? null,
    color: parsed.data.color ?? null,
  };
  if (id) {
    updateEvent(id, data);
  } else {
    const newId = createEvent(data, me.id);
    revalidatePath("/calendar");
    return { ok: true, id: newId };
  }
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteEventAction(id: number): Promise<ActionResult> {
  await requireUser();
  deleteEvent(id);
  revalidatePath("/calendar");
  return { ok: true };
}
