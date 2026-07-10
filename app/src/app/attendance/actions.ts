"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { setBookingStatus } from "@/lib/timetable";

const idSchema = z.coerce.number().int().positive();

function revalidate() {
  revalidatePath("/attendance");
  revalidatePath("/attendance/bookings");
  revalidatePath("/timetable");
}

export async function setAttendanceAction(
  bookingId: number,
  status: "booked" | "attended" | "no_show",
) {
  await requireUser();
  const st = z.enum(["booked", "attended", "no_show"]).safeParse(status);
  const id = idSchema.safeParse(bookingId);
  if (!st.success || !id.success) return;
  setBookingStatus(id.data, st.data);
  revalidate();
}

export async function cancelBookingAction(bookingId: number) {
  await requireUser();
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  setBookingStatus(id.data, "cancelled");
  revalidate();
}
