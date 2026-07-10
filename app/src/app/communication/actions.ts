"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  getConversationThread,
  type ConversationDetail,
} from "@/lib/conversations";
import { setLeadStatus } from "@/lib/leads";
import { sendWhatsApp } from "@/lib/whatsapp/send";
import {
  clearConversationDraft,
  retriageConversation,
} from "@/lib/inbox/triagePipeline";

type Kind = "lead" | "client";

/** Load a contact's full thread for the inbox right pane. */
export async function loadThreadAction(
  kind: Kind,
  contactId: number,
): Promise<
  { ok: true; detail: ConversationDetail } | { ok: false; error: string }
> {
  try {
    await requireUser();
    const detail = getConversationThread(kind, contactId);
    if (!detail) return { ok: false, error: "Conversation not found." };
    return { ok: true, detail };
  } catch {
    return { ok: false, error: "Could not load the conversation." };
  }
}

/** Send a WhatsApp reply from the inbox to a lead or client. */
export async function sendInboxMessageAction(
  kind: Kind,
  contactId: number,
  text: string,
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  try {
    await requireUser();
    const { messageId } = await sendWhatsApp({
      subjectType: kind,
      subjectId: contactId,
      text,
    });
    // A human has now replied — resolve any staged AI draft so it doesn't
    // reappear when the thread reloads. A fresh draft is created on the next
    // inbound message via triage.
    clearConversationDraft(kind, contactId);
    // Mirror the per-contact pages' side effects.
    if (kind === "lead") {
      setLeadStatus(contactId, "contacted");
      revalidatePath(`/leads/${contactId}`);
      revalidatePath("/leads");
    } else {
      revalidatePath(`/clients/${contactId}`);
    }
    revalidatePath("/communication");
    return { ok: true, messageId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "WhatsApp send failed.",
    };
  }
}

/** Re-run AI triage on a conversation whose latest inbound message wasn't triaged. */
export async function retriageAction(
  kind: Kind,
  contactId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireUser();
    await retriageConversation(kind, contactId);
    revalidatePath("/communication");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Re-triage failed.",
    };
  }
}
