"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { getAgreementSettings, setAgreementSettings, welcomeChoices } from "@/lib/agreements";
import { checkinChoices, setCheckinSettings } from "@/lib/checkins";

/** Turn "agree before using the app" on or off, and pick the Welcome Q&A. Admin only. */
export async function saveAgreementSettingsAction(input: { on: boolean; welcomeFormId: number | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const p = z.object({ on: z.boolean(), welcomeFormId: z.number().int().positive().nullable() }).safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a questionnaire or none." };
  if (p.data.welcomeFormId !== null && !welcomeChoices().some((f) => f.id === p.data.welcomeFormId)) {
    return { ok: false, error: "That questionnaire no longer exists." };
  }
  setAgreementSettings({ ...getAgreementSettings(), ...p.data });
  revalidatePath("/my-app");
  return { ok: true };
}

/** The weekly check-in: which Check-in form, and the day it falls due. Admin only. */
export async function saveCheckinSettingsAction(input: { formId: number | null; weekday: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const p = z.object({ formId: z.number().int().positive().nullable(), weekday: z.number().int().min(1).max(7) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a form and a day." };
  if (p.data.formId !== null && !checkinChoices().some((f) => f.id === p.data.formId)) return { ok: false, error: "That form no longer exists." };
  setCheckinSettings(p.data);
  revalidatePath("/my-app");
  return { ok: true };
}
