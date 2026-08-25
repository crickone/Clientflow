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
  // Sales/Marketing/Operations/Concierge CATALOG entries were retired here
  // (single-agent product, 2026-08-25): the operator chose to show only
  // Adonis + dormant Finance on /agents. Adonis absorbed all four agents'
  // tools + playbooks in the prior Adonis-merge task (commit dddfa27) and
  // does their work directly — no hand-offs. This is a catalog/UI change
  // ONLY: `specialists/{sales,marketing,operations}.ts` + their entries in
  // the `SPECIALISTS` map (./specialists/index.ts) are deliberately UNTOUCHED
  // — `specialists/orchestrator.ts` still imports SALES_SPECIALIST/
  // MARKETING_SPECIALIST/OPERATIONS_SPECIALIST to build Adonis's deduplicated
  // 52-tool union (see that file's doc comment). The Concierge never had a
  // `SPECIALISTS` entry (its system/tools are computed at runtime by
  // `buildAssistantSystem`/`conciergeToolSlice`, already folded into Adonis's
  // own toolNames the same way) — removing its catalog row here is the whole
  // change for it. The prune loop below (`ensureAgents`) deletes all four
  // agents' rows from every tenant DB automatically on next load — agent rows
  // only ever originate from this catalog, so pruning a now-catalog-absent
  // key is safe by construction, exactly like the pre-existing "e.g. SEO"
  // prune case already documented there.
  {
    key: "finance",
    name: "Finance",
    mandate: "Guards the cash: overdue + failed payments.",
    roles: ["Chases overdue payments", "Handles failed payments"],
    status: "dormant",
    defaultModel: MODELS.sonnet,
  },
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
