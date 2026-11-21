"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import { bust } from "@/lib/revalidate";
import { isCardId, mergeForSave, parseCard, type PlatformSettings } from "@/lib/settingsCards";

/**
 * Save one settings card. The app's PUT /settings requires the plan and email
 * price fields on every call, so the other cards' values are read fresh from
 * the app at save time and sent back unchanged: saving one card can never
 * reset another, even if the page was open for a while.
 */
export async function saveSettingsCard(
  card: string,
  values: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isCardId(card)) return { ok: false, error: "Unknown settings group." };
  const parsed = parseCard(card, values);
  if (!parsed.ok) return parsed;

  try {
    const current = await api<PlatformSettings>("/settings");
    await api("/settings", { method: "PUT", body: mergeForSave(current, parsed.patch) });
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Failed to save settings." };
  }

  bust();
  revalidatePath("/settings");
  return { ok: true };
}

/** The signed-in staff member's own alert emails. */
export async function saveNotifyPrefs(formData: FormData): Promise<void> {
  const notify = { instant: formData.get("instant") === "on", digest: formData.get("digest") === "on" };
  try {
    await api("/staff", { method: "PUT", body: { notify } });
  } catch (err) {
    redirect(`/settings?notifyError=${encodeURIComponent(err instanceof ApiError ? err.message : "Could not save that.")}`);
  }
  revalidatePath("/settings");
  redirect("/settings?saved=notify");
}
