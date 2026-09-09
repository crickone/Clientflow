"use server";

import { revalidatePath } from "next/cache";
import { setKey, type OpeningHour } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";

export interface SchedulePayload {
  openingHours: { dow: number; closed: boolean; open: string; close: string }[];
  bufferMinutes: number;
}

/**
 * Takes a typed payload rather than FormData: the schedule form autosaves from
 * its own state, so there is no submit event to read a form element from.
 */
export async function saveScheduleAction(payload: SchedulePayload) {
  await requireAdmin();

  // Rebuild all seven days from scratch so a malformed or partial payload can
  // never leave a day missing — a missing day reads as "closed" downstream.
  const openingHours: OpeningHour[] = [];
  for (let dow = 0; dow < 7; dow += 1) {
    const row = payload.openingHours.find((r) => r.dow === dow);
    const closed = row?.closed ?? false;
    openingHours.push({
      dow,
      closed,
      open: closed ? undefined : row?.open || "08:00",
      close: closed ? undefined : row?.close || "20:00",
    });
  }

  const buffer = Number(payload.bufferMinutes);

  setKey("opening_hours", openingHours);
  setKey("buffer_minutes", Number.isFinite(buffer) ? Math.max(0, Math.round(buffer)) : 0);

  revalidatePath("/settings/schedule");
  revalidatePath("/appointments");
  revalidatePath("/appointments/new");
}
