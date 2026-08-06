// Run: npm test -- src/lib/agents/context.test.ts
//
// Verifies Task 6 (4-layer agent context composition): the operator's custom
// instructions (from the Agents tab) are layered in BEFORE the safety rails,
// the safety rails are always present — even with empty instructions — and
// sit last (non-overridable), the tenant-isolation clause is present, and a
// business-context section is present. Exercises the REAL composeAgentSystem
// + getBusinessContext; nothing here is stubbed or mocked.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). This mirrors
// the exact pattern of src/lib/agents/registry.test.ts (Task 5).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// context.ts -> @/lib/agents/registry -> @/lib/db/tenant, and separately
// context.ts -> @/lib/ai/businessContext -> @/lib/db (the `db` proxy) ->
// @/lib/db/tenant — both chains import React's server-only `cache` at module
// load. Under the runner's `--conditions=react-server`, npm's react
// "react-server" entry point is a stub that THROWS on load (same issue + fix
// as registry.test.ts / db/agentsTable.test.ts). Shim `react` with an
// identity `cache` BEFORE any of this is required, so the real code path
// loads unchanged. Installed via a dynamic require (below) rather than a
// static import, since a static `import ... from "./context"` would be
// hoisted and evaluated before this shim runs.
//
// Unlike registry.test.ts's narrower graph, `@/lib/db` (index.ts, pulled in
// by getBusinessContext -> `@/lib/db`) also statically imports `@/lib/tenants`
// for its boot-seed side effect, which imports `@/lib/auth` (for
// `hashPassword`), which statically imports `{ redirect } from
// "next/navigation"` at module scope. Loading that pulls in Next's real
// client-router internals (app-router-context.shared-runtime.js), which need
// genuine React (`createContext`, ...) — not just `cache`. `redirect` itself
// is never actually CALLED anywhere in this test's code path (we never hit an
// auth guard), so stub it to throw loudly if that ever changes, rather than
// pull in real next/navigation.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in context.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as apiKeys.test.ts).
(async () => {
  const { controlSqlite } =
    requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } =
    requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { ensureAgents, updateAgentInstructions } =
    requireLocal("./registry") as typeof import("./registry");
  const { composeAgentSystem, SAFETY_RAILS } =
    requireLocal("./context") as typeof import("./context");

  // ── scratch tenant (control row + a real tenant DB file, so
  // getTenantDbById() resolves it, ensureTenantTables() gives us real
  // `agents`/`settings`/`therapies` tables, and getBusinessContext() has a
  // real — if default/empty — business profile + venue type + services list
  // to read, all without stubbing anything) ──
  const slug = "agents-context-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Agents Context Test", dbFile) as { id: number };
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
    // ensureAgents/updateAgentInstructions take an explicit tenantId and go
    // straight through getTenantDbById — no ambient tenant needed for setup.
    ensureAgents(tid);

    // composeAgentSystem calls getBusinessContext(), which reads the AMBIENT
    // tenant (the @/lib/db request/AsyncLocalStorage proxy) rather than a
    // `tenantId` argument. runWithTenant binds that ambient context for the
    // duration of the synchronous callback — exactly how a detached job (or
    // a request already scoped to this tenant) must call this function per
    // the doc comment on composeAgentSystem.

    // ── (b) rails always present, even with empty (never-edited) instructions ──
    const withEmpty = runWithTenant(tid, () => composeAgentSystem(tid, "sales"));
    assert.ok(
      withEmpty.includes(SAFETY_RAILS),
      "SAFETY_RAILS is present verbatim even when operator instructions are empty",
    );
    assert.ok(
      !withEmpty.includes("=== OPERATOR INSTRUCTIONS"),
      "no operator-instructions section is emitted when instructions are empty",
    );

    // ── set a distinctive marker as the operator's custom instructions ──
    const marker = "OPERATOR-MARKER-9F2Q-always-mention-the-free-parking-voucher";
    updateAgentInstructions(tid, "sales", marker);

    const out = runWithTenant(tid, () => composeAgentSystem(tid, "sales"));

    // ── (a) the custom-instructions marker appears, and strictly BEFORE the
    // safety rails. Guard both indexOf calls against -1 first: a naive
    // `markerIndex < railsIndex` would spuriously pass if the marker were
    // simply absent (-1 < anyPositiveIndex is true), so this must confirm
    // both are actually present before comparing their order. ──
    const markerIndex = out.indexOf(marker);
    const railsIndex = out.indexOf("NON-NEGOTIABLE");
    assert.notEqual(markerIndex, -1, "operator instructions marker appears in the composed prompt");
    assert.notEqual(railsIndex, -1, "SAFETY_RAILS marker text appears in the composed prompt");
    assert.ok(markerIndex < railsIndex, "operator instructions come BEFORE the safety rails");

    // ── rails are the final layer, verbatim — not overridable by operator text ──
    assert.ok(
      out.endsWith(SAFETY_RAILS),
      "SAFETY_RAILS is the last layer of the composed prompt",
    );

    // ── (c) tenant-isolation clause present ──
    assert.ok(
      out.includes("Never reference or touch another tenant"),
      "tenant-isolation clause is present",
    );

    // ── (d) a business-context section is present ──
    assert.ok(out.includes("BUSINESS CONTEXT"), "business-context section is present");

    console.log("context.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
