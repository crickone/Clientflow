"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { setCampaignBuildModel } from "@/lib/campaigns/buildModel";

/**
 * Campaign Engine Slice 4, Task 5 — admin action behind the "Campaign build
 * model" selector on the campaigns hub (./page.tsx). Re-checks admin itself
 * (`requireAdmin`, the same guard every other actions.ts in this codebase
 * leads with — e.g. @/app/agents/actions.ts, @/app/settings/schedule/actions.ts)
 * rather than trusting the page's own `requireAdminPage()` render gate: a
 * server action is its own POST endpoint, reachable directly regardless of
 * what rendered the form that normally points at it.
 *
 * setCampaignBuildModel (Task 1) throws on any id outside MODEL_CATALOG.
 * Caught here — rather than left to propagate, as saveModel/saveCapEur do in
 * agents/actions.ts — because those are called from CLIENT components that
 * wrap the call in try/catch and toast the error; this hub's selector is a
 * plain server-rendered `<form action={...}>` with no client JS to catch a
 * rejection. Its <select> only ever offers catalog ids, so a thrown error
 * here means a direct/tampered POST, not a normal user mistake: a silent
 * no-op (page just re-renders with the unchanged value) is correct, a 500
 * is not.
 */
export async function setCampaignBuildModelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("model") ?? "");
  try {
    await setCampaignBuildModel(id);
  } catch {
    return;
  }
  revalidatePath("/marketing/campaigns");
}
