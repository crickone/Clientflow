"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import {
  AdsError,
  createAdDraft,
  deleteAdDraft,
  launchAdCampaign,
  refreshAdInsights,
  searchAdCities,
  searchAdInterests,
  setAdCampaignStatus,
  setAdSetBudget,
  updateAdDraft,
} from "@/lib/ads/service";
import type { CampaignSpec } from "@/lib/ads/spec";

/**
 * Server actions for the ads manager. Admin-only: launching, resuming and
 * budget changes spend the business's money on its own ad account. Every
 * result is typed; Meta's refusal reasons are passed through in plain words.
 */
export type AdsResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T> | T): Promise<AdsResult<T>> {
  try {
    await requireAdmin();
    const data = await fn();
    revalidatePath("/marketing/ads");
    return { ok: true, data };
  } catch (err) {
    if (err instanceof AdsError) return { ok: false, error: err.message };
    // Next's redirect() (from requireAdmin) must propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("[ads] action failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function saveAdDraftAction(id: number | null, adAccountId: string, spec: CampaignSpec): Promise<AdsResult<{ id: number }>> {
  return run(async () => {
    const me = await requireAdmin();
    const row = id ? updateAdDraft(id, { adAccountId, spec }) : createAdDraft({ adAccountId, spec, createdBy: me.email ?? String(me.id) });
    return { id: row.id };
  });
}

export async function deleteAdDraftAction(id: number): Promise<AdsResult> {
  return run(() => { deleteAdDraft(id); return undefined; });
}

export async function launchAdCampaignAction(id: number): Promise<AdsResult> {
  return run(async () => { await launchAdCampaign(id); return undefined; });
}

export async function setAdCampaignStatusAction(id: number, status: "active" | "paused" | "archived"): Promise<AdsResult> {
  return run(async () => { await setAdCampaignStatus(id, status); return undefined; });
}

export async function setAdSetBudgetAction(id: number, adSetIndex: number, dailyBudget: number): Promise<AdsResult> {
  return run(async () => { await setAdSetBudget(id, adSetIndex, Number(dailyBudget)); return undefined; });
}

export async function refreshAdInsightsAction(id: number): Promise<AdsResult> {
  return run(async () => { await refreshAdInsights(id); return undefined; });
}

export async function searchInterestsAction(q: string) {
  return run(() => searchAdInterests(String(q ?? "")));
}

export async function searchCitiesAction(q: string) {
  return run(() => searchAdCities(String(q ?? "")));
}
