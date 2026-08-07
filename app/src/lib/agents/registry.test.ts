// Run: npm test -- src/lib/agents/registry.test.ts
//
// Verifies Task 5 (agent registry): AGENT_CATALOG seeding is idempotent and
// covers all six roles, per-agent status defaults (sales active, finance
// dormant), the instructions mutation persists, and the model mutation
// persists allowed tiers while permanently rejecting Fable.
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

    // ── seeds the six-agent catalog once (idempotent), sales active / finance dormant ──
    ensureAgents(tid);
    ensureAgents(tid); // calling twice must not duplicate rows or throw
    const all = listAgents(tid);
    assert.equal(all.length, AGENT_CATALOG.length, "ensureAgents is idempotent — no duplicate rows");
    assert.deepEqual(
      all.map((a) => a.key).sort(),
      [...AGENT_CATALOG.map((a) => a.key)].sort(),
      "listAgents returns exactly the six AGENT_CATALOG keys",
    );
    assert.equal(getAgent(tid, "sales")!.status, "active");
    assert.equal(getAgent(tid, "finance")!.status, "dormant");

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
