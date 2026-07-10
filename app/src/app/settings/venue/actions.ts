"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { setVenueType, type VenueType } from "@/lib/settings";

export async function updateVenueType(value: VenueType) {
  await requireAdmin();
  const v: VenueType = value === "gym" ? "gym" : "clinic";
  setVenueType(v);
  // Vocabulary is resolved in the root layout, so revalidate the whole tree.
  revalidatePath("/", "layout");
  return { ok: true as const, venueType: v };
}
