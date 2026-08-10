// Run: npm test -- src/lib/db/tenant.test.ts
//
// Batch 6a (scale-hardening smalls, improvement-plan-2026-08.md Theme E5):
// (1) the pure LRU-eviction decision behind connCache's cap (pickLruEviction)
// — deliberately NOT opening 51 real better-sqlite3 handles to prove real
// eviction end-to-end; that would be slow and only re-prove what this pure
// function already proves (same philosophy as db/control.test.ts's
// shouldRunToday) — and (2) that openTenantDb() actually applies the WAL
// tuning pragmas (wal_autocheckpoint, busy_timeout) on a real connection, plus
// a smoke test of checkpointAllOpenConnections() over that same connection.
import assert from "node:assert/strict";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// lib/db/tenant.ts imports React's server-only `cache` at module load. Under
// the runner's `--conditions=react-server`, npm's react "react-server" entry
// point is a stub that THROWS on load (same issue + fix as
// db/agentsTable.test.ts). Shim `react` with an identity `cache` BEFORE
// tenant.ts is required, so the real code path loads unchanged. Installed via
// a dynamic require (below) rather than a static import, since a static
// `import ... from "./tenant"` would be hoisted and evaluated before this
// shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// ── pickLruEviction: pure, no DB needed ─────────────────────────────────────
{
  const { pickLruEviction } = requireLocal("./tenant") as typeof import("./tenant");

  assert.equal(pickLruEviction([], 50), null, "empty cache -> nothing to evict");
  assert.equal(pickLruEviction(["a", "b", "c"], 50), null, "under cap -> nothing to evict");
  assert.equal(pickLruEviction(["a", "b"], 2), null, "exactly AT cap (not over) -> nothing to evict");
  assert.equal(
    pickLruEviction(["oldest", "middle", "newest"], 2),
    "oldest",
    "over cap -> evicts the LEAST-recently-used key (index 0, per connCache's LRU->MRU iteration order)",
  );
  assert.equal(
    pickLruEviction(["a", "b", "c", "d"], 1),
    "a",
    "well over cap -> still just the single LRU key (one evict per open call is always enough)",
  );
}

// ── openTenantDb: WAL pragmas + checkpoint pass on a real connection ───────
// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as agentsTable.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("./control") as typeof import("./control");
  const { openTenantDb, checkpointAllOpenConnections } =
    requireLocal("./tenant") as typeof import("./tenant");

  const slug = "wal-pragma-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "WAL Pragma Test", dbFile) as { id: number };
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
    // Opens (and creates) the scratch tenant DB — applies the WAL tuning
    // pragmas exactly like any real tenant open.
    const conn = openTenantDb(dbFile);
    sqlite = conn.sqlite;

    const autocheckpoint = sqlite.pragma("wal_autocheckpoint", { simple: true }) as number;
    assert.equal(autocheckpoint, 1000, "wal_autocheckpoint is set to 1000 pages on open");

    const busyTimeout = sqlite.pragma("busy_timeout", { simple: true }) as number;
    assert.equal(
      busyTimeout,
      15000,
      "busy_timeout stays at the pre-existing 15000 (above the brief's 5000 floor, so not lowered)",
    );

    // checkpointAllOpenConnections smoke test: control + this cached tenant
    // conn both checkpoint cleanly (best-effort — asserting it neither throws
    // nor reports either connection as failed).
    const summary = checkpointAllOpenConnections();
    assert.equal(summary.failed.length, 0, "no connection reported failed");
    assert.ok(summary.ok.includes("control"), "control connection checkpointed");
    assert.ok(summary.ok.includes(dbFile), "the scratch tenant connection checkpointed");

    console.log("db/tenant.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
