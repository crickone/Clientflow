// Run: npm test -- src/lib/agents/registry.test.ts
//
// Verifies Task 5 (agent registry): AGENT_CATALOG seeding is idempotent and
// covers every catalog role, per-agent status defaults (orchestrator active —
// the only entry now), the instructions mutation persists, and the model
// mutation persists allowed tiers while permanently rejecting Fable.
//
// Extended for multi-provider Task 3 (MP3): updateAgentModel's allowlist is
// now MODEL_CATALOG (@/lib/ai/modelCatalog) itself, not a hand-maintained
// {sonnet,opus,haiku} Set — so it must also accept the DeepSeek/OpenRouter
// catalog id, and still reject anything NOT in the catalog (Fable, and any
// other unknown id).
//
// Extended for the agent-roles brief ("Roles — what this agent handles" on
// /agents/[key]): AgentDef gained a `roles: string[]` field, catalog-only
// metadata (like `mandate`) never written to the DB. Covers: every catalog
// entry has a non-empty `roles` array with no blank entries.
//
// Single-agent product (2026-08-25): AGENT_CATALOG's `sales`/`marketing`/
// `operations`/`concierge` entries were retired, and then Finance too —
// /agents now shows ONLY Adonis (`orchestrator`); Adonis absorbed the first
// four agents' tools/playbooks in the prior Adonis-merge task (commit
// dddfa27), and Finance (only ever a dormant placeholder, never built) will
// be folded in later. This removed the generic active-agent role "sales" used
// to play in the mutation checks below (instructions/model persistence, Fable
// rejection, OpenRouter catalog ids) — `orchestrator` plays it now, since
// it's the only entry left. It also removed the first-class-Concierge
// coverage this file used to carry in full (concierge seeding active with a
// model, surviving a second `ensureAgents` call, per-agent `updateAgentModel`)
// — that behaviour is gone along with the Concierge's own `agents` row/card,
// so it's replaced below by an assertion that the 5 retired keys are neither
// in AGENT_CATALOG nor seed a row at all. The status-reconcile check
// (originally keyed on "marketing", covering a tenant row seeded under an
// older catalog with a stale `status`) now uses "orchestrator" — the same
// generic mechanism, just replayed against a key that's still in the
// catalog to reconcile against.
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
    updateAgentDisabledTools,
    parseDisabledTools,
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
    // ── roles metadata (agent-roles-brief: "Roles — what this agent handles"
    // on /agents/[key]): every catalog entry carries a non-empty, plain-
    // English `roles` array with no blank entries. Plain data, no DB/tenant
    // needed; also proves the AgentDef interface change (adding
    // `roles: string[]`) compiles. `roles` is catalog-only metadata like
    // `mandate` — never written to the DB (see ensureAgents' insert/patch
    // below, which only ever touches key/name/status/model/instructions) — so
    // this static check is the only coverage it needs. ──
    for (const a of AGENT_CATALOG) {
      assert.ok(Array.isArray(a.roles) && a.roles.length > 0, `AGENT_CATALOG["${a.key}"].roles is a non-empty array`);
      for (const role of a.roles) {
        assert.ok(
          typeof role === "string" && role.trim().length > 0,
          `AGENT_CATALOG["${a.key}"].roles has no blank/non-string entries`,
        );
      }
    }

    // getTenantDbById(tid) must actually resolve the scratch tenant.
    assert.ok(getTenantDbById(tid), "getTenantDbById resolves the scratch tenant");

    // ── seeds the whole AGENT_CATALOG once (idempotent); orchestrator is the sole entry, active ──
    ensureAgents(tid);
    ensureAgents(tid); // calling twice must not duplicate rows or throw
    const all = listAgents(tid);
    assert.equal(all.length, AGENT_CATALOG.length, "ensureAgents is idempotent — no duplicate rows");
    assert.deepEqual(
      all.map((a) => a.key).sort(),
      [...AGENT_CATALOG.map((a) => a.key)].sort(),
      "listAgents returns exactly the AGENT_CATALOG keys, one row each",
    );
    assert.equal(getAgent(tid, "orchestrator")!.status, "active");

    // ── single-agent product (2026-08-25): sales/marketing/operations/
    // concierge — and now Finance — are retired: not in AGENT_CATALOG, and
    // (the real proof, not just a catalog-shape check) ensureAgents never
    // seeds a row for any of them, so /agents can never resurface one of
    // their cards from a leftover DB row either ──
    for (const retiredKey of ["sales", "marketing", "operations", "concierge", "finance"]) {
      assert.ok(!AGENT_CATALOG.some((a) => a.key === retiredKey), `${retiredKey} is not an AGENT_CATALOG entry`);
      assert.equal(getAgent(tid, retiredKey), undefined, `${retiredKey} has no seeded agent row`);
    }

    // ── persists edited instructions ──
    updateAgentInstructions(tid, "orchestrator", "Always mention the 7-day trial.");
    assert.ok(
      getAgent(tid, "orchestrator")!.instructions.includes("7-day trial"),
      "updateAgentInstructions persists the new text",
    );

    // ── model mutation: allowed tiers persist ──
    updateAgentModel(tid, "orchestrator", MODELS.opus);
    assert.equal(getAgent(tid, "orchestrator")!.model, MODELS.opus, "updateAgentModel persists an allowed model");

    // ── NEVER Fable: an unsupported model id is rejected, and the previous
    // (already-mutated) model is left untouched by the rejected attempt ──
    assert.throws(
      () => updateAgentModel(tid, "orchestrator", "claude-fable-5"),
      /Unsupported model/,
      "updateAgentModel throws on a non-allowlisted model (Fable guard)",
    );
    assert.equal(
      getAgent(tid, "orchestrator")!.model,
      MODELS.opus,
      "rejected model update did not mutate the row",
    );

    // ── MP3: the allowlist IS the catalog — the DeepSeek/OpenRouter catalog
    // id must succeed exactly like an Anthropic tier does, and a made-up id
    // that was never in either the old {sonnet,opus,haiku} Set or the new
    // catalog must still be rejected (not just Fable specifically) ──
    const openRouterEntry = MODEL_CATALOG.find((m) => m.provider === "openrouter");
    assert.ok(openRouterEntry, "MODEL_CATALOG has an OpenRouter (DeepSeek) entry to test against");
    updateAgentModel(tid, "orchestrator", openRouterEntry!.id);
    assert.equal(
      getAgent(tid, "orchestrator")!.model,
      openRouterEntry!.id,
      "updateAgentModel persists the DeepSeek/OpenRouter catalog id",
    );
    assert.throws(
      () => updateAgentModel(tid, "orchestrator", "not-a-real-model-id"),
      /Unsupported model/,
      "updateAgentModel throws on an id that is in neither the catalog nor any legacy allowlist",
    );
    assert.equal(
      getAgent(tid, "orchestrator")!.model,
      openRouterEntry!.id,
      "rejected unknown-model update did not mutate the row",
    );

    // ── tool-access toggles (disabled_tools): round-trip + fail-soft parse.
    // The chat route drops these from the agent's toolkit; the Agent page
    // seeds the toggles from them. Default is nothing disabled. ──
    assert.deepEqual(
      parseDisabledTools(getAgent(tid, "orchestrator")!.disabledTools),
      [],
      "a freshly-seeded agent disables no tools (null disabled_tools -> [])",
    );
    updateAgentDisabledTools(tid, "orchestrator", ["send_client_email", "launch_campaign", "send_client_email"]);
    assert.deepEqual(
      parseDisabledTools(getAgent(tid, "orchestrator")!.disabledTools).sort(),
      ["launch_campaign", "send_client_email"],
      "updateAgentDisabledTools persists a DEDUPED disabled set that parseDisabledTools reads back",
    );
    updateAgentDisabledTools(tid, "orchestrator", []);
    assert.deepEqual(
      parseDisabledTools(getAgent(tid, "orchestrator")!.disabledTools),
      [],
      "an empty set clears all tool restrictions",
    );
    // parseDisabledTools is fail-soft — a corrupt value must never crash a chat
    // turn or the agent page; it just means "no restrictions".
    assert.deepEqual(parseDisabledTools(null), [], "parseDisabledTools(null) -> []");
    assert.deepEqual(parseDisabledTools("not json"), [], "parseDisabledTools(malformed JSON) -> []");
    assert.deepEqual(parseDisabledTools('{"a":1}'), [], "parseDisabledTools(non-array) -> []");
    assert.deepEqual(parseDisabledTools('["a", 2, "b", null]'), ["a", "b"], "parseDisabledTools keeps only string entries");

    // ── status-reconcile: AGENT_CATALOG is the single source of truth for
    // `status` — there is no UI/API to change it directly (unlike
    // instructions/model above), so a tenant whose row was seeded under an
    // OLDER catalog needs ensureAgents to bring status in line on every
    // call. Force the orchestrator row back to a stale "dormant" via a raw
    // update — bypassing ensureAgents entirely — and set distinctive
    // tenant-owned instructions/model, so the assertions below can prove the
    // reconcile touches ONLY `status` and leaves those two alone. (This used
    // to force "marketing" dormant — Marketing was dormant before it went
    // live — but marketing is retired from AGENT_CATALOG now, below, so
    // orchestrator stands in: registry.ts's own comment notes its real
    // history includes exactly this kind of reconcile, having been renamed
    // from "Orchestrator" to "Adonis".) ──
    const reconcileTenantDb = getTenantDbById(tid);
    reconcileTenantDb
      .update(agents)
      .set({ status: "dormant", instructions: "KEEP ME", model: "claude-opus-4-8" })
      .where(eq(agents.key, "orchestrator"))
      .run();
    // Confirm the forced write landed by reading the raw row DIRECTLY —
    // deliberately NOT via getAgent()/listAgents(), since both call
    // ensureAgents() as their first line and would immediately reconcile
    // status back to "active" before this setup check ever ran, defeating
    // the point of it.
    const beforeReconcile = reconcileTenantDb.select().from(agents).where(eq(agents.key, "orchestrator")).get();
    assert.equal(
      beforeReconcile?.status,
      "dormant",
      "setup: orchestrator row forced back to a stale \"dormant\" directly (bypassing ensureAgents)",
    );

    ensureAgents(tid); // the function under test — must reconcile the stale row above

    const orchestratorRow = getAgent(tid, "orchestrator")!;
    assert.equal(
      orchestratorRow.status,
      "active",
      "ensureAgents reconciles an existing row's status to match AGENT_CATALOG (dormant -> active)",
    );
    assert.equal(
      orchestratorRow.instructions,
      "KEEP ME",
      "ensureAgents' status reconcile does NOT touch tenant-owned instructions",
    );
    assert.equal(
      orchestratorRow.model,
      "claude-opus-4-8",
      "ensureAgents' status reconcile does NOT touch tenant-owned model",
    );

    // ── prune (single-agent product, 2026-08-25): a tenant whose row was
    // seeded under an OLDER catalog that still had "marketing" (or sales/
    // operations/concierge) keeps a stale row the seed loop above never
    // deletes on its own — that's what the prune pass at the bottom of
    // ensureAgents is for. Simulate that by raw-inserting a "marketing" row
    // directly (ensureAgents itself would never create one for a
    // catalog-absent key — that's the retired-keys check earlier in this
    // test), then confirm ensureAgents actually removes it: the concrete,
    // end-to-end proof — not just a catalog-shape assertion — that a retired
    // agent's row can never linger and resurface its card on /agents. ──
    reconcileTenantDb
      .insert(agents)
      .values({ key: "marketing", name: "Marketing", status: "active", model: MODELS.sonnet, instructions: "" })
      .run();
    assert.ok(
      reconcileTenantDb.select().from(agents).where(eq(agents.key, "marketing")).get(),
      "setup: a stale \"marketing\" row exists directly in the DB (bypassing ensureAgents)",
    );
    ensureAgents(tid); // the function under test — must prune the stale row above
    assert.equal(
      getAgent(tid, "marketing"),
      undefined,
      "ensureAgents prunes a stale row whose key is no longer in AGENT_CATALOG",
    );

    console.log("registry.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
