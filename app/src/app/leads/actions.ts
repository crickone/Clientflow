"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { leadMessages, leads } from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  addMessage,
  setLeadStatus,
  upsertLead,
  type LeadStatus,
} from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { sendWhatsApp } from "@/lib/whatsapp/send";
import { setStageToId } from "@/lib/pipeline/stage";
import { dialLead } from "@/lib/voice/dial";
import { cancelForLead } from "@/lib/voice/queue";
import { getCurrentTenantDb } from "@/lib/db/tenant";

/** Operator override of a lead's pipeline stage (e.g. mark Lost, or correct). */
export async function setLeadStageAction(leadId: number, stageId: number) {
  await requireUser();
  setStageToId(leadId, stageId);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
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
    db.run(
      `UPDATE leads SET status = 'contacted', updated_at = unixepoch()*1000
       WHERE id = ${row.leadId} AND status = 'new'`,
    );
    revalidatePath(`/leads/${row.leadId}`);
    revalidatePath("/leads");
  }
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
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function deleteLeadAction(id: number) {
  await requireUser();
  const leadId = z.number().int().positive().parse(id);
  db.delete(leadMessages).where(eq(leadMessages.leadId, leadId)).run();
  db.delete(leads).where(eq(leads.id, leadId)).run();
  revalidatePath("/leads");
  redirect("/leads");
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
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update this lead." };
  }
}
