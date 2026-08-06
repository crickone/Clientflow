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

  const priceEur = parseFloat(priceRaw);
  const vatPct = parseFloat(vatRaw);

  if (!Number.isFinite(priceEur) || priceEur < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative monthly price.")}`);
  }
  if (!Number.isFinite(vatPct) || vatPct < 0) {
    redirect(`/settings?error=${encodeURIComponent("Enter a valid, non-negative VAT rate.")}`);
  }

  const monthlyPriceCents = Math.round(priceEur * 100);
  const vatRateBp = Math.round(vatPct * 100);

  let errorMsg: string | null = null;
  try {
    await api("/settings", { method: "PUT", body: { monthlyPriceCents, vatRateBp } });
  } catch (err) {
    errorMsg = err instanceof ApiError ? err.message : "Failed to save settings.";
  }

  if (errorMsg) {
    redirect(`/settings?error=${encodeURIComponent(errorMsg)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
