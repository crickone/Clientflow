"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { leadMessages, leads } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import {
  addMessage,
  setLeadStatus,
  upsertLead,
  type LeadStatus,
} from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { sendWhatsApp } from "@/lib/whatsapp/send";
import { setStageManual, type PipelineStage } from "@/lib/pipeline/stage";

/** Operator override of a lead's pipeline stage (e.g. mark Lost, or correct). */
export async function setLeadStageAction(leadId: number, stage: PipelineStage) {
  await requireUser();
  setStageManual(leadId, stage);
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

export async function createManualLeadAction(formData: FormData) {
  await requireUser();
  const parsed = manualSchema.parse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName") || undefined,
    email: formData.get("email") || "",
    phone: formData.get("phone") || undefined,
    therapyInterest: formData.get("therapyInterest") || undefined,
    campaign: formData.get("campaign") || undefined,
    notes: formData.get("notes") || undefined,
  });

  const { lead } = upsertLead({
    source: "manual",
    firstName: parsed.firstName,
    lastName: parsed.lastName ?? null,
    email: parsed.email || null,
    phone: parsed.phone ?? null,
    therapyInterest: parsed.therapyInterest ?? null,
    campaign: parsed.campaign ?? null,
    notes: parsed.notes ?? null,
  });

  await logActivity(
    "lead.new",
    `Lead added manually: ${parsed.firstName} ${parsed.lastName ?? ""}`.trim(),
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
