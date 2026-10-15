"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { validateBroadcast } from "@/lib/whatsappBroadcastModel";
import { cancelBroadcast, createBroadcast, deleteBroadcast, getBroadcast, launchBroadcast, saveDraft } from "@/lib/whatsappBroadcasts";

export async function newBroadcastAction(): Promise<void> {
  await requireAdmin();
  const id = createBroadcast("New WhatsApp broadcast");
  redirect(`/campaigns/whatsapp/${id}`);
}

const draftSchema = z.object({ name: z.string().max(120), message: z.string().max(1200), audience: z.enum(["everyone", "active"]) });

export async function saveBroadcastAction(id: number, draft: { name: string; message: string; audience: "everyone" | "active" }): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const p = draftSchema.safeParse(draft);
  if (!p.success) return { ok: false, error: "Check the name and message." };
  if (!saveDraft(Number(id), p.data)) return { ok: false, error: "This broadcast has already been sent." };
  revalidatePath("/campaigns/whatsapp");
  return { ok: true };
}

/** Save the latest draft and send it now, or at `sendAt` (ms). */
export async function sendBroadcastAction(
  id: number,
  draft: { name: string; message: string; audience: "everyone" | "active" },
  sendAt: number | null,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await requireAdmin();
  const p = draftSchema.safeParse(draft);
  if (!p.success) return { ok: false, error: "Check the name and message." };
  const invalid = validateBroadcast(p.data.message);
  if (invalid) return { ok: false, error: invalid };
  if (sendAt !== null && (!Number.isFinite(sendAt) || sendAt < Date.now() - 60_000)) return { ok: false, error: "Pick a time in the future." };
  if (!saveDraft(Number(id), p.data)) return { ok: false, error: "This broadcast has already been sent." };
  const r = launchBroadcast(Number(id), sendAt);
  revalidatePath("/campaigns/whatsapp");
  revalidatePath(`/campaigns/whatsapp/${id}`);
  return r;
}

export async function stopBroadcastAction(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  if (!cancelBroadcast(Number(id))) return { ok: false, error: "It has already finished." };
  revalidatePath(`/campaigns/whatsapp/${id}`);
  return { ok: true };
}

export async function deleteBroadcastAction(id: number): Promise<void> {
  await requireAdmin();
  const b = getBroadcast(Number(id));
  if (b?.status === "draft") deleteBroadcast(Number(id));
  revalidatePath("/campaigns/whatsapp");
  redirect("/campaigns/whatsapp");
}
