"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { setLeadMarketingConsent } from "@/lib/leadFlows/consent";

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
