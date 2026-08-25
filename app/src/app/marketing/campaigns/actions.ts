"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { setCampaignBuildModel } from "@/lib/campaigns/buildModel";
import { setCampaignAdSpend } from "@/lib/campaigns/store";
import { seedTestCampaign, removeTestCampaign } from "@/lib/campaigns/demoSeed";

/**
 * Campaign Engine Slice 4, Task 5 — admin action behind the "Campaign build
 * model" selector on the campaigns hub (./page.tsx). Re-checks admin itself
 * (`requireAdmin`, the same guard every other actions.ts in this codebase
 * leads with — e.g. @/app/agents/actions.ts, @/app/settings/schedule/actions.ts)
 * rather than trusting the page's own `requireAdminPage()` render gate: a
 * server action is its own POST endpoint, reachable directly regardless of
 * what rendered the form that normally points at it.
 *
 * setCampaignBuildModel (Task 1) throws on any id outside CAMPAIGN_MODEL_CHOICES
 * (@/lib/campaigns/buildModel — the native-Anthropic Haiku/Sonnet/Opus subset
 * meteredCreate can actually run, NOT the full agent-chat MODEL_CATALOG).
 * Caught here — rather than left to propagate, as saveModel/saveCapEur do in
 * agents/actions.ts — because those are called from CLIENT components that
 * wrap the call in try/catch and toast the error; this hub's selector is a
 * plain server-rendered `<form action={...}>` with no client JS to catch a
 * rejection. Its <select> only ever offers catalog ids, so a thrown error
 * here means a direct/tampered POST, not a normal user mistake: a silent
 * no-op (page just re-renders with the unchanged value) is correct, a 500
 * is not. The catch still logs (Task 5 review, M2) — an invalid id is one
 * expected cause, but so is a genuine DB-write failure in setKey, and those
 * two must not be indistinguishable in the logs.
 */
export async function setCampaignBuildModelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("model") ?? "");
  try {
    await setCampaignBuildModel(id);
  } catch (err) {
    console.error("[setCampaignBuildModelAction]", err);
    return;
  }
  revalidatePath("/marketing/campaigns");
}

/**
 * Campaign Engine Slice 5, Task 4 — admin action behind the ad-spend editor
 * on the campaign hub (./[id]/page.tsx). Same `requireAdmin` re-check FIRST,
 * for the same reason as setCampaignBuildModelAction above: a server action
 * is its own reachable POST endpoint regardless of what rendered the form
 * that normally points at it, so the hub page's own requireAdminPage() gate
 * (which is what actually keeps the editor off a non-admin's screen — see
 * the hub page's comment) can't be the only thing standing between a
 * tampered request and a write.
 *
 * `eur` is guarded with `Number.isFinite` (not just `setCampaignAdSpend`'s
 * own `Math.max(0, Math.round(...))` clamp) because a non-numeric `adSpend`
 * field — an empty/tampered submit — turns `Number(...)` into `NaN`, and
 * `Math.max(0, NaN)` is itself `NaN`, not 0: better-sqlite3 binds a JS `NaN`
 * as SQL `NULL`, which would then fail `ad_spend_cents`' NOT NULL constraint
 * and throw instead of no-opping. Falling back to 0 here keeps that path a
 * plain "clear the spend" rather than a 500. `campaignId` needs no matching
 * guard: an invalid/NaN id also binds NULL, but only into the UPDATE's WHERE
 * clause, which just matches zero rows — an inherently safe no-op already.
 */
export async function setCampaignAdSpendAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const campaignId = Number(formData.get("campaignId"));
  const eur = Number(formData.get("adSpend"));
  const cents = Math.round((Number.isFinite(eur) ? Math.max(0, eur) : 0) * 100);
  setCampaignAdSpend(campaignId, cents);
  revalidatePath(`/marketing/campaigns/${campaignId}`);
}

/**
 * Demo-data controls behind the "Demo data" card on the campaigns hub
 * (./page.tsx) — seed a fully-populated "Test Campaign" (+ a few clearly-marked
 * demo leads/clients so the Performance columns light up) to preview the page,
 * and remove it again. Both `requireAdmin`-gated FIRST like every action here:
 * a server action is its own POST endpoint, so the page's requireAdminPage()
 * render gate can't be the only guard. Tenant is the caller's own (the seed
 * runs through the ambient tenant `db` proxy — see @/lib/campaigns/demoSeed).
 */
export async function seedTestCampaignAction(): Promise<void> {
  await requireAdmin();
  seedTestCampaign();
  revalidatePath("/marketing/campaigns");
}

export async function removeTestCampaignAction(): Promise<void> {
  await requireAdmin();
  removeTestCampaign();
  revalidatePath("/marketing/campaigns");
}
