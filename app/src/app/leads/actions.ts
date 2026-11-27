"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { leadMessages, leads } from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  addMessage,
  setLeadStatus,
  upsertLead,
  addToPipeline,
  type LeadStatus,
} from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { sendWhatsApp } from "@/lib/whatsapp/send";
import { isEmailConfigured, renderEmailShell, sendEmail, textToParagraphs } from "@/lib/email";
import { loadAttachments } from "@/lib/attachments/load";
import { emailAttachmentsFrom, emailAttachmentsRefusal } from "@/lib/email/attachments";
import { setSentEmailMedia } from "@/lib/email/sentMedia";
import { mediaPlaceholder } from "@/lib/inbox/mediaModel";
import { getBusinessProfile } from "@/lib/businessProfile";
import { setStageToId } from "@/lib/pipeline/stage";
import { dialLead } from "@/lib/voice/dial";
import { cancelForLead } from "@/lib/voice/queue";
import { getCurrentTenant, getCurrentTenantDb } from "@/lib/db/tenant";
import { scoreLead } from "@/lib/leadScore";
import { allowContactAgain, forgetImportedPerson } from "@/lib/ghlImport/store";
import type { LeadScore } from "@/lib/leadScoreModel";

/**
 * Rescore a lead straight away after something the operator did (a move, a
 * message), so the new score is on screen when the page refreshes rather
 * than after the next minute's ticker run. Never throws; null when Jev isn't
 * set up or didn't answer in time (the ticker then catches it).
 */
async function rescore(leadId: number): Promise<LeadScore | null> {
  try {
    return await scoreLead(getCurrentTenant().id, leadId, 3000);
  } catch {
    return null;
  }
}

/** Operator override of a lead's pipeline stage (e.g. mark Lost, or correct). */
export async function setLeadStageAction(leadId: number, stageId: number): Promise<{ score: LeadScore | null }> {
  await requireUser();
  // Picking a stage for a conversation from the Inbox puts it on the board first.
  addToPipeline(leadId, "user");
  setStageToId(leadId, stageId);
  const score = await rescore(leadId);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { score };
}

const manualSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  therapyInterest: z.string().optional(),
  campaign: z.string().optional(),
  notes: z.string().optional(),
});

export type LeadFormState = {
  ok: boolean;
  errors?: Record<string, string>;
};

/** `useFormState`-compatible: bad input (e.g. a malformed email) used to
 * throw straight out of `manualSchema.parse()` with no catch anywhere on the
 * call path, crashing the whole page instead of showing an inline error —
 * `safeParse` + a returned error map (same shape as `ClientFormState`, see
 * app/clients/actions.ts) fixes that. */
export async function createManualLeadAction(
  _prev: LeadFormState | null,
  formData: FormData,
): Promise<LeadFormState> {
  await requireUser();
  const parsed = manualSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName") || undefined,
    email: formData.get("email") || "",
    phone: formData.get("phone") || undefined,
    therapyInterest: formData.get("therapyInterest") || undefined,
    campaign: formData.get("campaign") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      errors[issue.path.join(".")] = issue.message;
    }
    return { ok: false, errors };
  }
  const v = parsed.data;

  const { lead } = upsertLead({
    source: "manual",
    actor: "user",
    firstName: v.firstName,
    lastName: v.lastName ?? null,
    email: v.email || null,
    phone: v.phone ?? null,
    therapyInterest: v.therapyInterest ?? null,
    campaign: v.campaign ?? null,
    notes: v.notes ?? null,
  });

  await logActivity(
    "lead.new",
    `Lead added manually: ${v.firstName} ${v.lastName ?? ""}`.trim(),
    { leadId: lead.id },
  );

  await rescore(lead.id);
  revalidatePath("/leads");
  redirect(`/leads/${lead.id}`);
}

export async function updateLeadStatusAction(
  id: number,
  status: LeadStatus,
) {
  await requireUser();
  setLeadStatus(id, status);
  await logActivity("lead.status", `Lead #${id} → ${status}`, { leadId: id });
  await rescore(id);
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}

/**
 * Marks a draft as sent by stamping `sent_at` and (optionally) updating the
 * content if the operator edited the AI's draft before sending.
 */
export async function markMessageSentAction(
  messageId: number,
  content: string,
) {
  await requireUser();
  db.update(leadMessages)
    .set({ content, sentAt: new Date() })
    .where(eq(leadMessages.id, messageId))
    .run();
  // If status was 'new', bump it to 'contacted'.
  const row = db
    .select({ leadId: leadMessages.leadId })
    .from(leadMessages)
    .where(eq(leadMessages.id, messageId))
    .get();
  if (row) {
    db.run(sql`UPDATE leads SET status = 'contacted', updated_at = unixepoch()*1000 WHERE id = ${row.leadId} AND status = 'new'`);
    await rescore(row.leadId);
    revalidatePath(`/leads/${row.leadId}`);
    revalidatePath("/leads");
  }
}

/**
 * Email a lead from the business's connected email (branded layout), and
 * record it on the lead as a sent email. When an existing draft is sent, that
 * draft row becomes the sent message. Returns an error string instead of
 * throwing so the UI keeps the operator's text.
 */
export async function sendLeadEmailAction(
  leadId: number,
  input: { subject: string; text: string; draftMessageId?: number; attachments?: string[] },
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  await requireUser();
  const text = input.text.trim();
  const subject = input.subject.trim();
  let files;
  try {
    files = loadAttachments(input.attachments);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That attachment has expired. Attach it again." };
  }
  if (!text && files.length === 0) return { ok: false, error: "Write the email first." };
  if (!subject) return { ok: false, error: "Add a subject." };
  const attachments = emailAttachmentsFrom(files);
  const refusal = emailAttachmentsRefusal(attachments);
  if (refusal) return { ok: false, error: refusal };
  const lead = db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead?.email) return { ok: false, error: "This lead has no email address." };
  if (!isEmailConfigured()) return { ok: false, error: "Connect an email in Settings > Email first." };
  const business = getBusinessProfile().businessName;
  const res = await sendEmail({
    to: lead.email,
    subject,
    html: renderEmailShell({ businessName: business, bodyHtml: textToParagraphs(text), footer: `Sent by ${business}.` }),
    text,
    ...(attachments.length ? { attachments } : {}),
  });
  if (!res.ok) return { ok: false, error: res.error };

  // The files are noted on the timeline row; an email that is only files
  // keeps a placeholder word so search and the list preview aren't blank.
  const media = files.map((f) => f.media);
  const content = text || (media[0] ? mediaPlaceholder(media[0].kind) : text);
  const mediaJson = media.length ? JSON.stringify(media) : null;
  let messageId = input.draftMessageId ?? 0;
  const draft = messageId
    ? db.select().from(leadMessages).where(eq(leadMessages.id, messageId)).get()
    : undefined;
  if (draft && draft.leadId === leadId) {
    db.update(leadMessages)
      .set({ content, channel: "email", sentAt: new Date(), ...(mediaJson ? { media: mediaJson } : {}) })
      .where(eq(leadMessages.id, messageId))
      .run();
  } else {
    messageId = db
      .insert(leadMessages)
      .values({ leadId, direction: "outbound", channel: "email", content, media: mediaJson, sentAt: new Date() })
      .returning({ id: leadMessages.id })
      .get().id;
  }
  setSentEmailMedia(res.id, media);
  setLeadStatus(leadId, "contacted");
  await rescore(leadId);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { ok: true, messageId };
}

/**
 * Send a WhatsApp message to a lead via the bridge and record it as a sent
 * outbound message. Returns an error string instead of throwing so the UI can
 * surface it and keep the operator's text.
 */
export async function sendLeadWhatsAppAction(
  leadId: number,
  text: string,
  /** When sending an existing draft, the draft row to remove once sent. */
  replaceMessageId?: number,
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  await requireUser();
  try {
    const { messageId } = await sendWhatsApp({
      subjectType: "lead",
      subjectId: leadId,
      text,
    });
    if (replaceMessageId) {
      db.delete(leadMessages)
        .where(eq(leadMessages.id, replaceMessageId))
        .run();
    }
    setLeadStatus(leadId, "contacted");
    await rescore(leadId);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    return { ok: true, messageId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "WhatsApp send failed.",
    };
  }
}

export async function logInboundReplyAction(
  leadId: number,
  content: string,
  channel: "email" | "sms" | "whatsapp" | "call" | "manual" | "system",
) {
  await requireUser();
  addMessage({
    leadId,
    direction: "inbound",
    channel,
    content,
    sentAt: new Date(),
  });
  setLeadStatus(leadId, "replied");
  await rescore(leadId);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

/** A note for the team on the lead's activity. Not sent to the lead, and not read as a reply. */
export async function addLeadNoteAction(leadId: number, content: string): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const text = content.trim();
  if (!text) return { ok: false, error: "Write the note first." };
  if (text.length > 4000) return { ok: false, error: "Keep the note under 4,000 characters." };
  const lead = db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).get();
  if (!lead) return { ok: false, error: "That lead no longer exists." };
  const name = user.name?.trim().split(/\s+/)[0];
  const row = addMessage({ leadId, direction: "note", channel: "manual", content: name ? `${name}: ${text}` : text, sentAt: new Date() });
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, messageId: row.id };
}

export async function deleteLeadAction(id: number) {
  await requireAdmin();
  const leadId = z.number().int().positive().parse(id);
  db.delete(leadMessages).where(eq(leadMessages.leadId, leadId)).run();
  forgetImportedPerson({ leadId });
  db.delete(leads).where(eq(leads.id, leadId)).run();
  revalidatePath("/leads");
  redirect("/leads");
}

/** Clear a lead's do-not-contact (from an import). Admin only, like do not call. */
export async function allowContactAgainAction(leadId: number): Promise<{ ok: boolean }> {
  const user = await requireAdmin();
  const id = z.number().int().positive().parse(leadId);
  const ok = allowContactAgain(id);
  if (ok) {
    await logActivity("lead.contact_allowed", `Lead #${id}: contact allowed again by user #${user.id}`, { leadId: id });
    revalidatePath(`/leads/${id}`);
  }
  return { ok };
}

/**
 * Place a voice-agent call to this lead. Every gate — provider configured,
 * account entitled, under its spend cap, lead reachable and not opted out —
 * lives in `dialLead` (lib/voice/dial.ts), the single place that can make a
 * phone ring; this action only supplies who is asking.
 *
 * Admin-only: a phone call to a real person is not something a staff login
 * should be able to trigger, and it spends the account's money.
 */
export async function callLeadAction(
  leadId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAdmin();
  const res = await dialLead({ leadId, startedBy: `user:${user.id}` });
  revalidatePath(`/leads/${leadId}`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

/**
 * Mark a lead as do-not-call, or clear it. A hard block on every future dial
 * (see dialLead) — an opt-out on a sales call is a legal obligation, so it
 * lives on the lead itself rather than as a tag an automation could move off.
 * The change is logged to the lead's own timeline so there is a record of when
 * it was set and by whom.
 */
export async function setLeadDoNotCallAction(
  leadId: number,
  doNotCall: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAdmin();
  try {
    db.update(leads).set({ doNotCall }).where(eq(leads.id, leadId)).run();
    // Setting the flag is not enough on its own: a call already queued by the
    // flow would still go out. Cancel it in the same action, so "do not call"
    // takes effect immediately rather than at the next dial's gate.
    if (doNotCall) cancelForLead(getCurrentTenantDb(), leadId, "Lead marked do-not-call");
    addMessage({
      leadId,
      direction: "note",
      channel: "system",
      content: doNotCall
        ? "Marked do-not-call — the voice agent will not phone this lead."
        : "Do-not-call cleared.",
    });
    await logActivity(
      "lead.do_not_call",
      `Lead #${leadId} do-not-call ${doNotCall ? "set" : "cleared"}`,
      { leadId, userId: user.id },
    );
    await rescore(leadId);
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update this lead." };
  }
}
