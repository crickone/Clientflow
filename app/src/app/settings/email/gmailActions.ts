"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireUser, getCurrentMembership } from "@/lib/auth";
import { deleteGmailConnection, syncGmailInbox } from "@/lib/gmail";

export type ActionResult = { ok: true } | { ok: false; error: string };

function tenantId(): number {
  const m = getCurrentMembership();
  if (!m) throw new Error("UNAUTHENTICATED");
  return m.tenant.id;
}

export async function disconnectGmailAction(): Promise<ActionResult> {
  await requireAdmin();
  deleteGmailConnection(tenantId());
  revalidatePath("/settings/email");
  revalidatePath("/communication");
  return { ok: true };
}

/** Pull the latest messages from Gmail into the inbox. */
export async function syncGmailAction(): Promise<
  { ok: true; synced: number } | { ok: false; error: string }
> {
  await requireUser();
  const res = await syncGmailInbox(tenantId());
  if (!res.ok) return res;
  revalidatePath("/communication");
  return { ok: true, synced: res.synced };
}
