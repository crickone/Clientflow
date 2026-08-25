import "server-only";
import { getTenantDbById } from "@/lib/db/tenant";
import { agents, type Agent } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { MODELS } from "@/lib/ai/client";
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";

// `roles` is catalog-only metadata (like `mandate`) — a plain-English list of
// what this agent is responsible for, shown on its detail page (/agents/[key]
// -> AgentDetail's "Roles — what this agent handles" section). It's never
// written to the DB: the seed loop (ensureAgents, below) only persists
// key/name/status/model/instructions, so adding this field doesn't touch the
// DB/seed at all.
export interface AgentDef { key: string; name: string; mandate: string; roles: string[]; status: "active" | "dormant"; defaultModel: string; }
export const AGENT_CATALOG: AgentDef[] = [
  {
    key: "orchestrator",
    name: "Adonis",
    mandate: "Your all-in-one assistant — handles leads, marketing, operations and admin directly.",
    roles: [
      "Replies to leads and follows up — no hand-offs",
      "Drafts on-brand marketing content and campaign kits",
      "Chases no-shows, fills classes, and wins back lapsed members",
      "Runs the inbox, invoices, plans, and general admin",
    ],
    status: "active",
    defaultModel: MODELS.sonnet,
  },
  // Single-agent product (2026-08-25): AGENT_CATALOG holds exactly one entry,
  // Adonis ("orchestrator"). The Sales/Marketing/Operations/Concierge
  // specialists and the dormant Finance placeholder were all retired — Adonis
  // absorbed the first four's tools + playbooks and now does the work directly,
  // and the whole delegate_to_* delegation subsystem was removed with them (the
  // specialist spec files + their SPECIALISTS entries are gone too; their tool
  // lists live inline in specialists/orchestrator.ts now). Finance was never
  // built and will fold into Adonis later. The prune loop below (`ensureAgents`)
  // deletes any tenant `agents` row whose key is no longer in this catalog
  // automatically on next load — agent rows only ever originate from here, so
  // pruning a now-catalog-absent key is safe by construction, exactly like the
  // pre-existing "e.g. SEO" prune case already documented there.
];

export function ensureAgents(tenantId: number): void {
  const db = getTenantDbById(tenantId);
  const existingRows = db.select({ key: agents.key, status: agents.status, name: agents.name }).from(agents).all();
  const existingByKey = new Map(existingRows.map(r => [r.key, r]));
  for (const a of AGENT_CATALOG) {
    const row = existingByKey.get(a.key);
    if (!row) {
      db.insert(agents).values({ key: a.key, name: a.name, status: a.status, model: a.defaultModel, instructions: "" }).run();
    } else {
      // Catalog-driven reconcile of the fields the catalog OWNS — `status` and
      // `name`. A tenant's row can have been seeded under an older AGENT_CATALOG
      // (Marketing was "dormant" before it went live; the top agent was named
      // "Orchestrator" before it became "Adonis"), and the insert-only branch
      // above never touches existing rows — so without this, that tenant's row
      // keeps the stale status/name forever. There's no UI to change either
      // directly, so the catalog is the single source of truth for both. Stay
      // deliberately narrow: ONLY `status` and `name` are written here —
      // `instructions`/`model` are tenant-owned (edited from the Agents tab)
      // and must never be overwritten by a reconcile.
      const patch: { status?: "active" | "dormant"; name?: string } = {};
      if (row.status !== a.status) patch.status = a.status;
      if (row.name !== a.name) patch.name = a.name;
      if (Object.keys(patch).length > 0) {
        db.update(agents).set(patch).where(eq(agents.key, a.key)).run();
      }
    }
  }
  // Prune agents removed from AGENT_CATALOG (e.g. SEO): the seed loop never
  // deletes, so a tenant seeded under an older catalog keeps stale rows that
  // would still render on the org chart. Safe: agent rows only ever originate
  // from the catalog, so anything not in it is stale.
  const catalogKeys = new Set(AGENT_CATALOG.map((a) => a.key));
  const stale = existingRows.filter((r) => !catalogKeys.has(r.key)).map((r) => r.key);
  if (stale.length > 0) {
    db.delete(agents).where(inArray(agents.key, stale)).run();
  }
}
export function listAgents(tenantId: number): Agent[] {
  ensureAgents(tenantId);
  const order = AGENT_CATALOG.map(a => a.key);
  return getTenantDbById(tenantId).select().from(agents).all()
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}
export function getAgent(tenantId: number, key: string): Agent | undefined {
  ensureAgents(tenantId);
  return getTenantDbById(tenantId).select().from(agents).where(eq(agents.key, key)).get();
}
export function updateAgentInstructions(tenantId: number, key: string, instructions: string): void {
  getTenantDbById(tenantId).update(agents).set({ instructions: instructions.slice(0, 8000), updatedAt: new Date() }).where(eq(agents.key, key)).run();
}
export function updateAgentModel(tenantId: number, key: string, model: string): void {
  // Allowlist == the picker's own catalog (@/lib/ai/modelCatalog), so a
  // model can only ever be saved if it's actually offered in the UI. NEVER
  // Fable: it's not (and must never be) in MODEL_CATALOG, so it can never
  // land in this Set — this line is the enforcement point for that promise.
  const allowed = new Set<string>(MODEL_CATALOG.map((m) => m.id));
  if (!allowed.has(model)) throw new Error("Unsupported model");
  getTenantDbById(tenantId).update(agents).set({ model, updatedAt: new Date() }).where(eq(agents.key, key)).run();
}

/**
 * Parse the `agents.disabled_tools` column (a JSON array of tool names the
 * agent may NOT use) into a plain string[]. Fail-soft to `[]` for null/absent
 * (nothing disabled = every tool on), malformed JSON, or a non-array/non-string
 * payload — a corrupt value must never crash a chat turn or the agent page, it
 * just means "no restrictions". Used by the chat route (to drop disabled tools
 * from the agent's toolkit) and the Agent detail page (to seed the toggles).
 */
export function parseDisabledTools(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Persist the agent's disabled-tools set (the OFF list) for this tenant.
 * Deduped and stored as a JSON array; an empty array clears all restrictions.
 * Caller (saveDisabledTools, @/app/agents/actions) validates the names against
 * the agent's real toolNames + re-checks admin first.
 */
export function updateAgentDisabledTools(tenantId: number, key: string, disabled: string[]): void {
  const clean = [...new Set(disabled.filter((x) => typeof x === "string"))];
  getTenantDbById(tenantId)
    .update(agents)
    .set({ disabledTools: JSON.stringify(clean), updatedAt: new Date() })
    .where(eq(agents.key, key))
    .run();
}
