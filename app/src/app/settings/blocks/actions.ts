"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { blockOuts } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

const daysOfWeekSchema = z
  .array(z.coerce.number().int().min(0).max(6))
  .min(1, "Pick at least one day.");

const recurringSchema = z.object({
  type: z.literal("recurring"),
  daysOfWeek: daysOfWeekSchema,
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().min(1),
});

const oneOffSchema = z.object({
  type: z.literal("one_off"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().min(1),
});

function parseRecurring(formData: FormData) {
  const rawDays = formData.getAll("daysOfWeek").map((v) => String(v));
  return recurringSchema.parse({
    type: "recurring",
    daysOfWeek: rawDays,
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    reason: formData.get("reason"),
  });
}

function parseOneOff(formData: FormData) {
  return oneOffSchema.parse({
    type: "one_off",
    date: formData.get("date"),
    endDate: formData.get("endDate"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    reason: formData.get("reason"),
  });
}

export async function createBlockAction(formData: FormData) {
  await requireAdmin();
  const type = String(formData.get("type") ?? "one_off");
  if (type === "recurring") {
    const v = parseRecurring(formData);
    db.insert(blockOuts)
      .values({
        type: "recurring",
        dayOfWeek: null,
        daysOfWeek: v.daysOfWeek.join(","),
        startTime: v.startTime,
        endTime: v.endTime,
        reason: v.reason,
      })
      .run();
  } else {
    const v = parseOneOff(formData);
    db.insert(blockOuts)
      .values({
        type: "one_off",
        date: v.date,
        endDate: v.endDate || v.date,
        startTime: v.startTime,
        endTime: v.endTime,
        reason: v.reason,
      })
      .run();
  }
  revalidatePath("/settings/blocks");
  revalidatePath("/appointments");
}

export async function updateBlockAction(id: number, formData: FormData) {
  await requireAdmin();
  const type = String(formData.get("type") ?? "one_off");
  if (type === "recurring") {
    const v = parseRecurring(formData);
    db.update(blockOuts)
      .set({
        type: "recurring",
        date: null,
        endDate: null,
        dayOfWeek: null,
        daysOfWeek: v.daysOfWeek.join(","),
        startTime: v.startTime,
        endTime: v.endTime,
        reason: v.reason,
      })
      .where(eq(blockOuts.id, id))
      .run();
  } else {
    const v = parseOneOff(formData);
    db.update(blockOuts)
      .set({
        type: "one_off",
        date: v.date,
        endDate: v.endDate || v.date,
        dayOfWeek: null,
        daysOfWeek: null,
        startTime: v.startTime,
        endTime: v.endTime,
        reason: v.reason,
      })
      .where(eq(blockOuts.id, id))
      .run();
  }
  revalidatePath("/settings/blocks");
  revalidatePath("/appointments");
}

export async function deleteBlockAction(id: number) {
  await requireAdmin();
  db.delete(blockOuts).where(eq(blockOuts.id, id)).run();
  revalidatePath("/settings/blocks");
  revalidatePath("/appointments");
}
