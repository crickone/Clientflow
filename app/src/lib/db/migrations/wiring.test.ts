// Run: npm test -- src/lib/db/migrations/wiring.test.ts
//
// Batch 6b (improvement-plan-2026-08.md Theme E1): confirms runMigrations()
// is actually WIRED IN at both call sites — openTenantDb() (../tenant.ts)
// runs TENANT_MIGRATIONS right after ensureTenantTables(), and the control
// plane's rawControl() (../control.ts) runs CONTROL_MIGRATIONS right after
// ensureControlTables() — by checking that "0001-baseline" lands in each
// plane's schema_migrations table. The pure runner semantics (apply-once,
// ordering, rollback) are covered against a scratch in-memory DB in
// index.test.ts; this file is specifically about the two real call sites.
import assert from "node:assert/strict";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// lib/db/tenant.ts imports React's server-only `cache` at module load. Under
// the runner's `--conditions=react-server`, npm's react "react-server" entry
// point is a stub that THROWS on load (same issue + fix as
// agentsTable.test.ts / tenant.test.ts). Shim `react` with an identity
// `cache` BEFORE tenant.ts is required, so the real code path loads
// unchanged. Installed via a dynamic require (below) rather than a static
// import, since a static `import ... from "../tenant"` would be hoisted and
// evaluated before this shim runs.
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
// top-level await is unsupported (same reasoning as agentsTable.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../control") as typeof import("../control");
  const { openTenantDb } = requireLocal("../tenant") as typeof import("../tenant");

  // ── Control plane: touching controlSqlite triggers rawControl() ->
  // ensureControlTables() -> runMigrations(sqlite, CONTROL_MIGRATIONS). ──
  const controlApplied = controlSqlite
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .get("0001-baseline");
  assert.ok(
    controlApplied,
    "control plane: 0001-baseline is recorded in schema_migrations after opening controlSqlite",
  );

  // ── Tenant plane: a scratch tenant DB, opened via openTenantDb() exactly
  // like any real tenant. ──
  const slug = "migrations-wiring-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Migrations Wiring Test", dbFile) as { id: number };
  const tid = t.id;

  let sqlite: BetterSqlite3 | undefined;
  const cleanup = () => {
    try {
      sqlite?.close();
    } catch {
      // best effort
    }
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
    // Opens (and creates) the scratch tenant DB — runs ensureTenantTables()
    // then runMigrations(sqlite, TENANT_MIGRATIONS), exactly like any real
    // tenant open.
    const conn = openTenantDb(dbFile);
    sqlite = conn.sqlite;

    const tenantApplied = sqlite
      .prepare("SELECT id FROM schema_migrations WHERE id = ?")
      .get("0001-baseline");
    assert.ok(
      tenantApplied,
      "tenant plane: 0001-baseline is recorded in schema_migrations after openTenantDb()",
    );

    console.log("migrations/wiring.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
