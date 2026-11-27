"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { sendClientEmail, type SendClientEmailResult } from "@/lib/clientEmail";
import { loadAttachments } from "@/lib/attachments/load";

export async function sendClientEmailAction(
  clientId: number,
  input: { subject: string; body: string; attachments?: string[] },
): Promise<SendClientEmailResult> {
  const me = await requireUser();
  let files;
  try {
    files = loadAttachments(input.attachments);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That attachment has expired. Attach it again." };
  }
  const res = await sendClientEmail(clientId, {
    subject: input.subject,
    body: input.body,
    sentByUserId: me.id,
    ...(files.length ? { attachments: files } : {}),
  });
  revalidatePath(`/clients/${clientId}`);
  return res;
}
