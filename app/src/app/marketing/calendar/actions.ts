"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { setMonthNote } from "@/lib/marketing/calendarNotes";

/**
 * Save the operator's marketing direction from the seasonal calendar. Guarded
 * with `requireAdmin` here rather than relying on the page's render gate — a
 * server action is its own entry point (the same reasoning as every other
 * actions.ts in this codebase).
 */

export async function saveMonthNoteAction(year: number, month: number, note: string) {
  await requireAdmin();
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) {
    return { ok: false as const, error: "Invalid year." };
  }
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    return { ok: false as const, error: "Invalid month." };
  }
  setMonthNote(y, m, String(note ?? ""));
  revalidatePath("/marketing/calendar");
  return { ok: true as const };
}
