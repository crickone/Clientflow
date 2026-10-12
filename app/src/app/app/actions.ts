"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { clientMembership } from "@/lib/clientApp";
import { bookClient, removeBooking } from "@/lib/timetable";
import { setScanConsent } from "@/lib/inbody/scans";

export type BookResult = { ok: true } | { ok: false; error: string };

const idSchema = z.coerce.number().int().positive();

export async function bookClassAction(sessionId: number): Promise<BookResult> {
  const { clientId } = requireClient();
  const p = idSchema.safeParse(sessionId);
  if (!p.success) return { ok: false, error: "Invalid class." };
  // An active membership is required to book.
  if (!clientMembership(clientId)) {
    return { ok: false, error: "You need an active membership to book classes." };
  }
  const res = bookClient(p.data, clientId);
  revalidatePath("/app/timetable");
  revalidatePath("/app");
  return res;
}

export async function cancelClassAction(sessionId: number): Promise<BookResult> {
  const { clientId } = requireClient();
  const p = idSchema.safeParse(sessionId);
  if (!p.success) return { ok: false, error: "Invalid class." };
  removeBooking(p.data, clientId);
  revalidatePath("/app/timetable");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * The member's own choice to see their InBody scans in the app, and to stop.
 * Their tenant comes from their client session; nothing here takes an id.
 */
export async function setBodyScanConsentAction(consent: boolean): Promise<{ ok: true }> {
  const { clientId } = requireClient();
  setScanConsent(clientId, consent === true);
  revalidatePath("/app/body");
  revalidatePath("/app");
  return { ok: true };
}
