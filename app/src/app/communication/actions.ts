"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentMembership, requireUser } from "@/lib/auth";
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
import {
  getEmailMessage,
  listThreadMessages,
  markThreadRead,
  syncGmailInbox,
  type EmailMessageRow,
} from "@/lib/gmail";
import { renderEmailShell, sendEmail, textToParagraphs } from "@/lib/email";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";

type Kind = "lead" | "client";

function currentTenantId(): number {
  const m = getCurrentMembership();
  if (!m) throw new Error("UNAUTHENTICATED");
  return m.tenant.id;
}

/** Reply to a synced email inside its Gmail thread. */
export async function replyEmailAction(
  messageId: number,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const parsed = z
    .object({ messageId: z.number().int(), body: z.string().trim().min(1, "Write a reply first") })
    .safeParse({ messageId, body });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  const msg = getEmailMessage(messageId);
  if (!msg) return { ok: false, error: "Message not found." };
  const to = msg.direction === "in" ? msg.fromEmail : msg.toEmail;
  if (!to) return { ok: false, error: "No address to reply to." };

  const subject = msg.subject ? msg.subject.replace(/^\s*(re:\s*)+/i, "").trim() : "";
  const business = getBusinessProfile().businessName;
  const html = renderEmailShell({
    businessName: business,
    accent: getTheme().accent,
    bodyHtml: textToParagraphs(parsed.data.body),
    footer: `Sent by ${business}.`,
  });

  const res = await sendEmail({
    to,
    subject: subject ? `Re: ${subject}` : "Re:",
    html,
    text: parsed.data.body,
    gmailThread: msg.gmailThreadId ? { threadId: msg.gmailThreadId } : undefined,
  });
  if (!res.ok) return res;

  await syncGmailInbox(currentTenantId(), { days: 1, max: 10 });
  revalidatePath("/communication");
  return { ok: true };
}

/** Manual "refresh" of the inbox from the Communication page. */
export async function refreshInboxAction(): Promise<
  { ok: true; synced: number } | { ok: false; error: string }
> {
  await requireUser();
  const res = await syncGmailInbox(currentTenantId());
  if (!res.ok) return res;
  revalidatePath("/communication");
  return { ok: true, synced: res.synced };
}

/** Load every message in a thread (full bodies) and mark it read. */
export async function loadEmailThreadAction(
  threadId: string,
): Promise<{ ok: true; messages: EmailMessageRow[] } | { ok: false; error: string }> {
  await requireUser();
  const messages = listThreadMessages(threadId);
  markThreadRead(threadId);
  revalidatePath("/communication");
  return { ok: true, messages };
}

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
