"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

/**
 * Bound directly to the settings `<form action={saveSettings}>` (no client
 * component needed) — feedback travels via `?saved=1` / `?error=…` on the
 * settings page's own searchParams, same pattern as `/gyms`'s GET search form.
 */
export async function saveSettings(formData: FormData): Promise<void> {
  const priceRaw = String(formData.get("monthlyPrice") ?? "");
  const vatRaw = String(formData.get("vatRate") ?? "");
  const emailPriceRaw = String(formData.get("emailPrice") ?? "");
  const aiMarginRaw = String(formData.get("aiMargin") ?? "");
  const emailIncludedRaw = String(formData.get("emailIncluded") ?? "");
  const voicePriceRaw = String(formData.get("voicePrice") ?? "");
  const voiceIncludedRaw = String(formData.get("voiceIncluded") ?? "");
  const voiceTrialRaw = String(formData.get("voiceTrial") ?? "");

  const priceEur = parseFloat(priceRaw);
  const vatPct = parseFloat(vatRaw);
  const emailPriceEur = parseFloat(emailPriceRaw);
  const aiMarginPct = parseFloat(aiMarginRaw);
  const emailIncluded = parseInt(emailIncludedRaw, 10);
  const voicePriceEur = parseFloat(voicePriceRaw);
  const voiceIncluded = parseInt(voiceIncludedRaw, 10);
  const voiceTrial = parseInt(voiceTrialRaw, 10);

  if (!Number.isFinite(priceEur) || priceEur < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative monthly price.")}`);
  }
  if (!Number.isFinite(vatPct) || vatPct < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative VAT rate.")}`);
  }
  if (!Number.isFinite(emailPriceEur) || emailPriceEur < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative email credit price.")}`);
  }
  if (!Number.isFinite(aiMarginPct) || aiMarginPct < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative AI credit margin.")}`);
  }
  if (!Number.isInteger(emailIncluded) || emailIncluded < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative number of included emails.")}`);
  }
  if (!Number.isFinite(voicePriceEur) || voicePriceEur < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative voice price per minute.")}`);
  }
  if (!Number.isInteger(voiceIncluded) || voiceIncluded < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative number of included voice minutes.")}`);
  }
  if (!Number.isInteger(voiceTrial) || voiceTrial < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative number of trial voice minutes.")}`);
  }

  const monthlyPriceCents = Math.round(priceEur * 100);
  const vatRateBp = Math.round(vatPct * 100);
  const emailCreditPricePer1000Cents = Math.round(emailPriceEur * 100);
  const aiCreditMarginBp = Math.round(aiMarginPct * 100);

  let errorMsg: string | null = null;
  try {
    await api("/settings", {
      method: "PUT",
      body: {
        monthlyPriceCents,
        vatRateBp,
        emailCreditPricePer1000Cents,
        aiCreditMarginBp,
        emailIncludedPerMonth: emailIncluded,
        voicePricePerMinuteCents: Math.round(voicePriceEur * 100),
        voiceIncludedMinutes: voiceIncluded,
        voiceTrialMinutes: voiceTrial,
      },
    });
  } catch (err) {
    errorMsg = err instanceof ApiError ? err.message : "Failed to save settings.";
  }

  if (errorMsg) {
    redirect(`/settings?error=${encodeURIComponent(errorMsg)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
