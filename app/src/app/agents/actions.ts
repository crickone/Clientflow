"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { AGENT_CATALOG, updateAgentInstructions, updateAgentModel } from "@/lib/agents/registry";

/**
 * Admin-gated server actions for the Agent detail page (/agents/[key]).
 *
 * Mirrors the `await requireAdmin()`-first pattern used throughout
 * `@/app/staff/actions.ts`: every action here re-checks admin on the server
 * regardless of what the calling page already enforced, because a server
 * action is its own POST endpoint — reachable directly, not only through the
 * page that renders its trigger.
 *
 * tenantId is ALWAYS derived from the caller's own current membership (never
 * accepted as an argument) so a client can't edit another tenant's agent by
 * passing a different tenantId — same reasoning as every other tenant-scoped
 * action in this codebase.
 */

function assertKnownAgent(key: string): void {
  if (!AGENT_CATALOG.some((a) => a.key === key)) throw new Error(`Unknown agent "${key}".`);
}

export async function saveInstructions(key: string, text: string): Promise<void> {
  await requireAdmin();
  assertKnownAgent(key);
  const tenantId = getCurrentMembership()!.tenant.id;
  updateAgentInstructions(tenantId, key, text);
  revalidatePath(`/agents/${key}`);
}

export async function saveModel(key: string, model: string): Promise<void> {
  await requireAdmin();
  assertKnownAgent(key);
  const tenantId = getCurrentMembership()!.tenant.id;
  // Throws "Unsupported model" for anything outside MODEL_CATALOG (the picker's
  // own list) — in particular Fable is permanently rejected here, and we
  // deliberately let that throw propagate rather than swallowing it into a
  // result object. This is a backstop only: the picker in AgentDetail offers
  // exactly the catalog (Sonnet 5, Opus 4.8, DeepSeek via OpenRouter), so in
  // normal use this never throws.
  updateAgentModel(tenantId, key, model);
  revalidatePath(`/agents/${key}`);
}
