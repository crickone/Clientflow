"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { AGENT_CATALOG, updateAgentInstructions, updateAgentModel, updateAgentDisabledTools } from "@/lib/agents/registry";
import { SPECIALISTS } from "@/lib/agents/specialists";
import { setTenantCapCents } from "@/lib/ai/usage";
import { candidateUrls, parseSkillMarkdown } from "@/lib/agents/skillImport";
import { MAX_SKILL_BODY } from "@/lib/agents/skills.parse";
import {
  createSkill,
  deleteSkill,
  setAgentSkills,
  updateSkill,
} from "@/lib/agents/skills";

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


/**
 * Which skills this agent is given.
 *
 * An ALLOWLIST of ids, admin-gated and tenant-derived like everything else in
 * this file. setAgentSkills drops ids that do not exist, so a form posted
 * before someone deleted a skill cannot write a dead one back onto the agent.
 */
export async function saveAgentSkills(key: string, ids: number[]): Promise<void> {
  await requireAdmin();
  assertKnownAgent(key);
  const tenantId = getCurrentMembership()!.tenant.id;
  setAgentSkills(tenantId, key, ids);
  revalidatePath(`/agents/${key}`);
}

/** Add a skill to this TENANT's library. It is off for every agent until switched on. */
export async function addSkill(input: {
  name: string;
  description: string;
  body: string;
}): Promise<void> {
  await requireAdmin();
  const tenantId = getCurrentMembership()!.tenant.id;
  if (!input.name.trim()) throw new Error("A skill needs a name.");
  createSkill(tenantId, input);
  revalidatePath("/agents");
}

export async function editSkill(
  id: number,
  input: { name: string; description: string; body: string },
): Promise<void> {
  await requireAdmin();
  const tenantId = getCurrentMembership()!.tenant.id;
  if (!input.name.trim()) throw new Error("A skill needs a name.");
  updateSkill(tenantId, id, input);
  revalidatePath("/agents");
}

/** Remove a skill, and take it off every agent that had it on. */
export async function removeSkill(id: number): Promise<void> {
  await requireAdmin();
  const tenantId = getCurrentMembership()!.tenant.id;
  deleteSkill(tenantId, id);
  revalidatePath("/agents");
}


/**
 * Fetch a skill from GitHub so it can be reviewed before it is saved.
 *
 * RETURNS THE FIELDS, SAVES NOTHING. What comes back goes into the form for a
 * human to read first. A skill's body is appended to an agent's system prompt
 * verbatim, so text fetched off the internet must not be able to get there
 * without someone having looked at it — the review IS the control.
 *
 * Only GitHub, enforced by candidateUrls returning nothing for any other host:
 * there is no list to fetch rather than a check that can be skipped. Redirects
 * are refused for the same reason, since following one would leave the
 * allowlist behind. Each candidate is tried in turn because a repository keeps
 * its SKILL.md in one of a few conventional places.
 */
export async function fetchSkillFrom(pasted: string): Promise<{
  name: string;
  description: string;
  body: string;
  source: string;
  truncated: boolean;
}> {
  await requireAdmin();
  const urls = candidateUrls(pasted);
  if (urls.length === 0) {
    throw new Error(
      "That needs to be a GitHub link — a repository, a SKILL.md, or an install line containing one.",
    );
  }

  const tried: string[] = [];
  for (const url of urls) {
    tried.push(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "text/plain" },
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;

    // Read a bounded amount. A body is capped at MAX_SKILL_BODY anyway, and
    // without a ceiling a wrong link could stream something enormous into the
    // server before anyone finds out it was not a skill.
    const text = (await res.text()).slice(0, MAX_SKILL_BODY * 4);
    const parsed = parseSkillMarkdown(text);
    if (!parsed) continue;

    return {
      name: parsed.name,
      description: parsed.description,
      body: parsed.body.slice(0, MAX_SKILL_BODY),
      source: url,
      truncated: parsed.body.length > MAX_SKILL_BODY,
    };
  }

  throw new Error(
    `No SKILL.md found. Tried ${tried.length} location${tried.length === 1 ? "" : "s"} — paste a direct link to the file if it lives somewhere else.`,
  );
}
