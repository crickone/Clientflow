"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { sendClientEmail, type SendClientEmailResult } from "@/lib/clientEmail";

export async function sendClientEmailAction(
  clientId: number,
  input: { subject: string; body: string },
): Promise<SendClientEmailResult> {
  const me = await requireUser();
  const res = await sendClientEmail(clientId, {
    subject: input.subject,
    body: input.body,
    sentByUserId: me.id,
  });
  revalidatePath(`/clients/${clientId}`);
  return res;
}
