"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { AGENT_CATALOG, updateAgentInstructions, updateAgentModel, updateAgentDisabledTools } from "@/lib/agents/registry";
import { SPECIALISTS } from "@/lib/agents/specialists";
import { setTenantCapCents } from "@/lib/ai/usage";

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

/**
 * Tool-access toggles (Agent detail page): persist the set of tools this agent
 * is NOT allowed to use. `disabled` is the full OFF list the client holds in
 * state (it sends the whole set on every toggle — single tool or a whole
 * category at once — so this is idempotent). We store ONLY names that are real
 * tools this agent actually has, so a stale/renamed/garbage name can never
 * linger in the set and a tool the agent doesn't have can't be "disabled".
 * Admin-only + tenant-derived like every action here; the chat route reads
 * this back to drop the disabled tools from the agent's toolkit.
 */
export async function saveDisabledTools(key: string, disabled: string[]): Promise<void> {
  await requireAdmin();
  assertKnownAgent(key);
  const tenantId = getCurrentMembership()!.tenant.id;
  const known = new Set<string>(SPECIALISTS[key]?.toolNames ?? []);
  const clean = [...new Set(disabled)].filter((t) => known.has(t));
  updateAgentDisabledTools(tenantId, key, clean);
  revalidatePath(`/agents/${key}`);
}

/**
 * Batch 3bc (C4): the one admin control for the per-tenant monthly AI spend
 * cap — the agent pages' usage copy has long promised "raise the cap in
 * Settings" with nothing actually behind it (see AiCapError in
 * @/lib/ai/usage). `eur` is whatever the CapEditor's number input holds;
 * `setTenantCapCents` does the real bounds validation (€1-€1000, whole cents)
 * and its thrown error is left to propagate to the client's catch, same
 * pattern as `saveModel` above letting "Unsupported model" propagate.
 */
export async function saveCapEur(eur: number): Promise<void> {
  await requireAdmin();
  const tenantId = getCurrentMembership()!.tenant.id;
  setTenantCapCents(tenantId, Math.round(eur * 100));
  revalidatePath("/agents");
}
