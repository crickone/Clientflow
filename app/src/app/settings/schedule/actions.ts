"use server";

import { revalidatePath } from "next/cache";
import { setKey } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth";

export async function saveScheduleAction(formData: FormData) {
  await requireAdmin();
  const slot = Number(formData.get("slotLengthMinutes") ?? 30);
  const buffer = Number(formData.get("bufferMinutes") ?? 0);
  const concurrent = formData.get("multiTherapyConcurrent") === "on";

  const openingHours = [];
  for (let dow = 0; dow < 7; dow += 1) {
    const closed = formData.get(`closed_${dow}`) === "on";
    const open = String(formData.get(`open_${dow}`) ?? "");
    const close = String(formData.get(`close_${dow}`) ?? "");
    openingHours.push({
      dow,
      closed,
      open: closed ? undefined : open || "08:00",
      close: closed ? undefined : close || "20:00",
    });
  }

  setKey("opening_hours", openingHours);
  setKey("slot_length_minutes", slot);
  setKey("buffer_minutes", buffer);
  setKey("multi_therapy_concurrent", concurrent);

  revalidatePath("/settings/schedule");
  revalidatePath("/appointments");
  revalidatePath("/appointments/new");
}
