"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentMembership, requireUser } from "@/lib/auth";
import {
  getConversationThread,
  type ConversationDetail,
} from "@/lib/conversations";
import { setLeadStatus } from "@/lib/leads";
import { sendReply, type ReplyChannel } from "@/lib/messaging/reply";
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
import { syncImapInbox } from "@/lib/imapEmail";
import { getEmailProvider, renderEmailShell, sendEmail, textToParagraphs } from "@/lib/email";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { emailMessages } from "@/lib/db/schema";
import { upsertLead } from "@/lib/leads";
import { draftEmailReply } from "@/lib/ai/draftEmailReply";
import { AiCapError } from "@/lib/ai/usage";
import { displaySender, htmlToText } from "@/lib/inbox/emailDisplay";
import { logActivity } from "@/lib/queries";

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
    // Threading headers so the reply lands in the same conversation on the
    // recipient's side over SMTP too, not just Gmail (gmailSend already
    // accepted inReplyTo/references — harmless to pass them there as well).
    gmailThread: {
      threadId: msg.gmailThreadId ?? undefined,
      inReplyTo: msg.gmailMessageId,
      references: msg.gmailThreadId ?? msg.gmailMessageId,
    },
  });
  if (!res.ok) return res;

  // Pull the just-sent message back down so it appears in the thread. Gmail
  // never records its own "out" row on send (see gmailSend), so it needs this
  // re-sync; IMAP/SMTP already inserted its own "out" row inside smtpSend, so
  // skip it there (and for "resend"/"none", there's nothing to re-sync).
  if (getEmailProvider() === "gmail") {
    await syncGmailInbox(currentTenantId(), { days: 1, max: 10 });
  }
  revalidatePath("/communication");
  return { ok: true };
}

/** Manual "refresh" of the inbox from the Communication page — provider-aware. */
export async function refreshInboxAction(): Promise<
  { ok: true; synced: number } | { ok: false; error: string }
> {
  await requireUser();
  const provider = getEmailProvider();

  if (provider === "gmail") {
    const res = await syncGmailInbox(currentTenantId());
    if (!res.ok) return res;
    revalidatePath("/communication");
    return { ok: true, synced: res.synced };
  }

  if (provider === "imap") {
    const res = await syncImapInbox(currentTenantId());
    if (!res.ok) return res;
    revalidatePath("/communication");
    return { ok: true, synced: res.synced };
  }

  // "resend" (send-only) or "none" — nothing to pull.
  return { ok: true, synced: 0 };
}

/** Load every message in a thread (full bodies) and mark it read. */
export async function loadEmailThreadAction(
  threadId: string,
): Promise<{ ok: true; messages: EmailMessageRow[] } | { ok: false; error: string }> {
  await requireUser();
  const messages = listThreadMessages(threadId);
  markThreadRead(threadId);
  // No revalidate: the inbox updates the row in place, and a full re-render of
  // the list on every open made reading feel slow.
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

/** Send a reply from the inbox on the channel the contact last wrote on (WhatsApp, Messenger or Instagram). */
export async function sendInboxMessageAction(
  kind: Kind,
  contactId: number,
  text: string,
): Promise<{ ok: true; messageId: number; channel: ReplyChannel } | { ok: false; error: string }> {
  try {
    await requireUser();
    const { messageId, channel } = await sendReply({
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
    return { ok: true, messageId, channel };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed.",
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

/** Mark several email threads read at once (inbox bulk action / shortcut). */
export async function markThreadsReadAction(
  threadIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const ids = z.array(z.string().min(1)).max(500).safeParse(threadIds);
  if (!ids.success || ids.data.length === 0) return { ok: false, error: "Nothing selected." };
  db.update(emailMessages)
    .set({ isRead: true })
    .where(and(inArray(emailMessages.gmailThreadId, ids.data), eq(emailMessages.direction, "in")))
    .run();
  return { ok: true };
}

export type ContactContext =
  | {
      type: "client";
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      href: string;
      since: number;
      membership: { name: string; status: string } | null;
    }
  | {
      type: "lead";
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      href: string;
      since: number;
      stage: string | null;
      source: string;
    }
  | { type: "unknown"; name: string; email: string | null };

/**
 * Who this is, for the side card next to a conversation: a member (with their
 * membership), a lead (with their pipeline stage), or someone not on file.
 */
export async function contactContextAction(input: {
  contact: { type: "client" | "lead"; id: number } | null;
  name: string;
  email: string | null;
}): Promise<ContactContext> {
  await requireUser();
  const email = input.email?.trim().toLowerCase() || null;
  let ref = input.contact;
  if (!ref && email) {
    const c = db.select({ id: schema.clients.id }).from(schema.clients).where(sql`lower(${schema.clients.email}) = ${email}`).get();
    if (c) ref = { type: "client", id: c.id };
    else {
      const l = db.select({ id: schema.leads.id }).from(schema.leads).where(sql`lower(${schema.leads.email}) = ${email}`).get();
      if (l) ref = { type: "lead", id: l.id };
    }
  }
  if (ref?.type === "client") {
    const c = db.select().from(schema.clients).where(eq(schema.clients.id, ref.id)).get();
    if (c) {
      const m = db
        .select({ name: schema.clientMemberships.membershipName, status: schema.clientMemberships.status })
        .from(schema.clientMemberships)
        .where(eq(schema.clientMemberships.clientId, c.id))
        .orderBy(desc(schema.clientMemberships.createdAt))
        .get();
      return {
        type: "client",
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        email: c.email,
        phone: c.phone || null,
        href: `/clients/${c.id}`,
        since: c.createdAt.getTime(),
        membership: m ?? null,
      };
    }
  }
  if (ref?.type === "lead") {
    const l = db.select().from(schema.leads).where(eq(schema.leads.id, ref.id)).get();
    if (l) {
      const stage = l.stageId
        ? db.select({ name: schema.pipelineStages.name }).from(schema.pipelineStages).where(eq(schema.pipelineStages.id, l.stageId)).get()
        : null;
      return {
        type: "lead",
        id: l.id,
        name: [l.firstName, l.lastName].filter(Boolean).join(" ").trim() || input.name,
        email: l.email,
        phone: l.phone,
        href: `/leads/${l.id}`,
        since: l.createdAt.getTime(),
        stage: stage?.name ?? null,
        source: l.source,
      };
    }
  }
  return { type: "unknown", name: input.name, email };
}

/** Add an email sender to the pipeline as a new lead. Safe to click twice. */
export async function addSenderAsLeadAction(input: {
  name: string;
  email: string;
}): Promise<{ ok: true; leadId: number } | { ok: false; error: string }> {
  await requireUser();
  const parsed = z.object({ name: z.string().trim().max(200), email: z.string().trim().email() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "This sender has no valid email address." };
  const email = parsed.data.email.toLowerCase();
  const { lead, created } = upsertLead({
    source: "email",
    sourceLeadId: `email:${email}`,
    actor: "user",
    fullName: parsed.data.name || null,
    email,
  });
  if (created) {
    await logActivity("lead.new", `Lead added from the inbox: ${parsed.data.name || email}`, { leadId: lead.id });
  }
  revalidatePath("/leads");
  return { ok: true, leadId: lead.id };
}

/** Adonis drafts a reply to an email thread; it lands in the reply box, never sent from here. */
export async function draftEmailReplyAction(
  threadId: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  await requireUser();
  const messages = listThreadMessages(threadId);
  if (messages.length === 0) return { ok: false, error: "Thread not found." };
  try {
    const text = await draftEmailReply({
      tenantId: currentTenantId(),
      subject: messages[messages.length - 1].subject ?? "",
      messages: messages.map((m) => ({
        direction: m.direction,
        from: displaySender(m.fromName, m.fromEmail).name,
        text: m.bodyText?.trim() || (m.bodyHtml ? htmlToText(m.bodyHtml) : m.snippet ?? ""),
        at: m.internalDate,
      })),
    });
    if (!text) return { ok: false, error: "Adonis could not write a draft. Try again." };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof AiCapError ? err.message : "Adonis could not write a draft right now." };
  }
}
