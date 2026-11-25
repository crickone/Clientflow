"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { assignLead } from "@/lib/leadFlows/assignment";
import { logCall, scheduleCall } from "@/lib/leadFlows/calls";
import { setLeadMarketingConsent } from "@/lib/leadFlows/consent";
import { zonedTimeToUtc } from "@/lib/leadFlows/sendingWindow";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const leadIdSchema = z.number().int().positive();

/** Staff record that a lead agreed (or no longer agrees) to marketing. */
export async function setLeadMarketingConsentAction(leadId: number, granted: boolean): Promise<ActionResult> {
  await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  if (!id.success) return { ok: false, error: "Lead not found." };
  const res = setLeadMarketingConsent(id.data, Boolean(granted), "staff");
  revalidatePath(`/leads/${id.data}`);
  return res.ok ? { ok: true, message: granted ? "Marked as agreed to marketing." : "Marketing consent removed." } : res;
}

/** Assign a lead to a staff member, or to nobody. */
export async function assignLeadAction(leadId: number, userId: number | null): Promise<ActionResult> {
  await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  if (!id.success) return { ok: false, error: "Lead not found." };
  const who = userId == null ? null : z.number().int().positive().safeParse(userId);
  if (who && !who.success) return { ok: false, error: "Pick someone from the list." };
  const res = assignLead(id.data, who ? who.data : null);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath("/leads");
  return res.ok ? { ok: true, message: userId == null ? "Unassigned." : "Assigned." } : res;
}

const logCallSchema = z.object({
  outcome: z.enum(["no_answer", "call_back", "spoke", "thinking", "booked"]),
  note: z.string().max(1000).optional().nullable(),
  callbackDay: z.string().optional().nullable(),
});

/** Log a call that just happened. */
export async function logCallAction(leadId: number, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  const parsed = logCallSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Lead not found." };
  if (!parsed.success) return { ok: false, error: "Pick what happened on the call." };
  const res = logCall(id.data, parsed.data, user.id);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath("/leads");
  return res.ok ? { ok: true, message: res.message } : res;
}

const scheduleSchema = z.object({
  /** Irish wall-clock date and time of a call at a time. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  /** A call-back day with no time. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

/** Schedule a call: at a time, on a day, or later with no day. */
export async function scheduleCallAction(leadId: number, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  const parsed = scheduleSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Lead not found." };
  if (!parsed.success) return { ok: false, error: "Pick a day, or a day and a time." };
  const { date, time, day } = parsed.data;
  const at = date && time ? zonedTimeToUtc(date, time) : null;
  const res = scheduleCall(id.data, { at, day: at ? null : (day ?? null) }, user.id);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath("/leads");
  revalidatePath("/calendar");
  return res.ok ? { ok: true, message: res.message } : res;
}
