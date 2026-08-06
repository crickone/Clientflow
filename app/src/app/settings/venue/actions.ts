"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import {
  setSchedulingMode,
  setVenueType,
  type SchedulingMode,
  type VenueType,
} from "@/lib/settings";

export async function updateVenueType(value: VenueType) {
  await requireAdmin();
  const v: VenueType = value === "gym" ? "gym" : "clinic";
  setVenueType(v);
  // Vocabulary is resolved in the root layout, so revalidate the whole tree.
  revalidatePath("/", "layout");
  return { ok: true as const, venueType: v };
}

export async function updateSchedulingMode(value: SchedulingMode) {
  await requireAdmin();
  const m: SchedulingMode = value === "timetable" ? "timetable" : "appointments";
  setSchedulingMode(m);
  // Nav is built in the layout — revalidate the whole tree so it updates.
  revalidatePath("/", "layout");
  return { ok: true as const, schedulingMode: m };
}
