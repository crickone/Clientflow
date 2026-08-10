// Run: npm test -- src/lib/agents/registry.test.ts
//
// Verifies Task 5 (agent registry): AGENT_CATALOG seeding is idempotent and
// covers every catalog role, per-agent status defaults (sales active, finance
// dormant), the instructions mutation persists, and the model mutation
// persists allowed tiers while permanently rejecting Fable.
//
// Extended for multi-provider Task 3 (MP3): updateAgentModel's allowlist is
// now MODEL_CATALOG (@/lib/ai/modelCatalog) itself, not a hand-maintained
// {sonnet,opus,haiku} Set — so it must also accept the DeepSeek/OpenRouter
// catalog id, and still reject anything NOT in the catalog (Fable, and any
// other unknown id).
//
// Extended for the first-class-Concierge task
// (.superpowers/sdd/concierge-agent-brief.md, Requirement 1): the Concierge
// is now a real AGENT_CATALOG entry (previously it had no `agents` row at
// all — see .superpowers/sdd/concierge-task-1-brief.md). Covers: it seeds
// active with a model, its model/instructions persist and survive a second
// `ensureAgents` call (idempotent — not reset, not duplicated, not pruned),
// and `updateAgentModel` accepts/rejects models for it exactly like every
// other agent.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). This mirrors
// the exact pattern of src/lib/apiKeys.test.ts and src/lib/db/agentsTable.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { MODELS } from "../ai/client";
import { MODEL_CATALOG } from "../ai/modelCatalog";

// registry.ts imports @/lib/db/tenant, which imports React's server-only
// `cache` at module load. Under the runner's `--conditions=react-server`,
// npm's react "react-server" entry point is a stub that THROWS on load (same
// issue + fix as db/agentsTable.test.ts and platform/analytics.test.ts). Shim
// `react` with an identity `cache` BEFORE registry.ts/tenant.ts are required,
// so the real code path loads unchanged. Installed via a dynamic require
// (below) rather than a static import, since a static `import ... from
// "./registry"` would be hoisted and evaluated before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as apiKeys.test.ts).
(async () => {
  const { controlSqlite } =
    requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } =
    requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { agents } =
    requireLocal("../db/schema") as typeof import("../db/schema");
  const {
    AGENT_CATALOG,
    ensureAgents,
    listAgents,
    getAgent,
    updateAgentInstructions,
    updateAgentModel,
  } = requireLocal("./registry") as typeof import("./registry");

  // ── scratch tenant (control row + a real tenant DB file, so
  // getTenantDbById() resolves it and openTenantDb() runs ensureTenantTables,
  // giving us a real `agents` table to seed into — not a hardcoded, never-
  // provisioned id) ──
  const slug = "agents-registry-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Agents Registry Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), {
        recursive: true,
        force: true,
      });
    } catch {
      // best effort
    }
  };

  try {
    // getTenantDbById(tid) must actually resolve the scratch tenant.
    assert.ok(getTenantDbById(tid), "getTenantDbById resolves the scratch tenant");

    // ── seeds the whole AGENT_CATALOG once (idempotent), sales active / finance dormant ──
    ensureAgents(tid);
    ensureAgents(tid); // calling twice must not duplicate rows or throw
    const all = listAgents(tid);
    assert.equal(all.length, AGENT_CATALOG.length, "ensureAgents is idempotent — no duplicate rows");
    assert.deepEqual(
      all.map((a) => a.key).sort(),
      [...AGENT_CATALOG.map((a) => a.key)].sort(),
      "listAgents returns exactly the AGENT_CATALOG keys, one row each",
    );
    assert.equal(getAgent(tid, "sales")!.status, "active");
    assert.equal(getAgent(tid, "finance")!.status, "dormant");

    // ── first-class Concierge (Requirement 1): seeded ACTIVE, with a real
    // model — unlike every other agent above, before this task it had NO
    // `agents` row at all (getAgent(tid, "concierge") returned undefined) ──
    const concierge = getAgent(tid, "concierge");
    assert.equal(concierge?.status, "active", "concierge seeds as an active agent, not dormant");
    assert.ok(concierge?.model, "concierge is seeded with a (non-empty) model");
    assert.equal(
      concierge!.model,
      MODELS.sonnet,
      "concierge defaults to the same default model (MODELS.sonnet) as the other active specialists",
    );

    // ── persists edited instructions ──
    updateAgentInstructions(tid, "sales", "Always mention the 7-day trial.");
    assert.ok(
      getAgent(tid, "sales")!.instructions.includes("7-day trial"),
      "updateAgentInstructions persists the new text",
    );

    // ── model mutation: allowed tiers persist ──
    updateAgentModel(tid, "sales", MODELS.opus);
    assert.equal(getAgent(tid, "sales")!.model, MODELS.opus, "updateAgentModel persists an allowed model");

    // ── NEVER Fable: an unsupported model id is rejected, and the previous
    // (already-mutated) model is left untouched by the rejected attempt ──
    assert.throws(
      () => updateAgentModel(tid, "sales", "claude-fable-5"),
      /Unsupported model/,
      "updateAgentModel throws on a non-allowlisted model (Fable guard)",
    );
    assert.equal(
      getAgent(tid, "sales")!.model,
      MODELS.opus,
      "rejected model update did not mutate the row",
    );

    // ── MP3: the allowlist IS the catalog — the DeepSeek/OpenRouter catalog
    // id must succeed exactly like an Anthropic tier does, and a made-up id
    // that was never in either the old {sonnet,opus,haiku} Set or the new
    // catalog must still be rejected (not just Fable specifically) ──
    const openRouterEntry = MODEL_CATALOG.find((m) => m.provider === "openrouter");
    assert.ok(openRouterEntry, "MODEL_CATALOG has an OpenRouter (DeepSeek) entry to test against");
    updateAgentModel(tid, "sales", openRouterEntry!.id);
    assert.equal(
      getAgent(tid, "sales")!.model,
      openRouterEntry!.id,
      "updateAgentModel persists the DeepSeek/OpenRouter catalog id",
    );
    assert.throws(
      () => updateAgentModel(tid, "sales", "not-a-real-model-id"),
      /Unsupported model/,
      "updateAgentModel throws on an id that is in neither the catalog nor any legacy allowlist",
    );
    assert.equal(
      getAgent(tid, "sales")!.model,
      openRouterEntry!.id,
      "rejected unknown-model update did not mutate the row",
    );

    // ── first-class Concierge (Requirement 4): updateAgentModel works for it
    // exactly like every other agent — it already calls the SAME generic
    // function, gated only by the SAME MODEL_CATALOG allowlist, with no
    // per-key special-casing anywhere in registry.ts ──
    updateAgentModel(tid, "concierge", MODELS.opus);
    assert.equal(getAgent(tid, "concierge")!.model, MODELS.opus, "updateAgentModel persists an allowed model for concierge");
    updateAgentModel(tid, "concierge", openRouterEntry!.id);
    assert.equal(
      getAgent(tid, "concierge")!.model,
      openRouterEntry!.id,
      "updateAgentModel persists the DeepSeek/OpenRouter catalog id for concierge too (Requirement 4 — OpenRouter models like Kimi)",
    );
    assert.throws(
      () => updateAgentModel(tid, "concierge", "claude-fable-5"),
      /Unsupported model/,
      "updateAgentModel rejects a non-catalog model for concierge (Fable guard applies here too)",
    );
    assert.equal(
      getAgent(tid, "concierge")!.model,
      openRouterEntry!.id,
      "rejected model update did not mutate the concierge row",
    );

    // ── first-class Concierge (Requirement 1): survives a second
    // ensureAgents call — tenant-owned model/instructions are neither reset
    // to catalog defaults nor duplicated into a second row, and the row is
    // NOT pruned (the prune pass only deletes rows whose key is missing from
    // AGENT_CATALOG; concierge is now a permanent member of it) ──
    updateAgentInstructions(tid, "concierge", "CONCIERGE-KEEP-ME");
    ensureAgents(tid); // the function under test, called again on an already-seeded tenant
    const concierges = listAgents(tid).filter((a) => a.key === "concierge");
    assert.equal(concierges.length, 1, "ensureAgents does not duplicate the concierge row on a second call");
    const conciergeAfter = getAgent(tid, "concierge")!;
    assert.equal(conciergeAfter.status, "active", "concierge is not pruned/reset by a second ensureAgents call");
    assert.equal(conciergeAfter.model, openRouterEntry!.id, "a second ensureAgents call does not reset concierge's model");
    assert.equal(
      conciergeAfter.instructions,
      "CONCIERGE-KEEP-ME",
      "a second ensureAgents call does not reset concierge's instructions",
    );

    // ── status-reconcile (Marketing Task 2): AGENT_CATALOG is the single
    // source of truth for `status` — there is no UI/API to change it
    // directly (unlike instructions/model above), so a tenant whose row was
    // seeded under an OLDER catalog (Marketing used to default to "dormant")
    // needs ensureAgents to bring status in line on every call. Force the
    // marketing row back to a stale "dormant" via a raw update — bypassing
    // ensureAgents entirely — and set distinctive tenant-owned
    // instructions/model, so the assertions below can prove the reconcile
    // touches ONLY `status` and leaves those two alone. ──
    const marketingTenantDb = getTenantDbById(tid);
    marketingTenantDb
      .update(agents)
      .set({ status: "dormant", instructions: "KEEP ME", model: "claude-opus-4-8" })
      .where(eq(agents.key, "marketing"))
      .run();
    // Confirm the forced write landed by reading the raw row DIRECTLY —
    // deliberately NOT via getAgent()/listAgents(), since both call
    // ensureAgents() as their first line and would immediately reconcile
    // status back to "active" before this setup check ever ran, defeating
    // the point of it.
    const beforeReconcile = marketingTenantDb.select().from(agents).where(eq(agents.key, "marketing")).get();
    assert.equal(
      beforeReconcile?.status,
      "dormant",
      "setup: marketing row forced back to a stale \"dormant\" directly (bypassing ensureAgents)",
    );

    ensureAgents(tid); // the function under test — must reconcile the stale row above

    const marketing = getAgent(tid, "marketing")!;
    assert.equal(
      marketing.status,
      "active",
      "ensureAgents reconciles an existing row's status to match AGENT_CATALOG (marketing dormant -> active)",
    );
    assert.equal(
      marketing.instructions,
      "KEEP ME",
      "ensureAgents' status reconcile does NOT touch tenant-owned instructions",
    );
    assert.equal(
      marketing.model,
      "claude-opus-4-8",
      "ensureAgents' status reconcile does NOT touch tenant-owned model",
    );

    // Sales was already correct ("active") throughout — the reconcile must
    // be a no-op for rows that already match the catalog, not just harmless
    // for the one row that changed.
    assert.equal(
      getAgent(tid, "sales")!.status,
      "active",
      "sales status is untouched by the marketing reconcile",
    );

    console.log("registry.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
