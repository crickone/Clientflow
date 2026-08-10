// Run: npm test -- src/lib/platform/queries.test.ts
//
// Unit tests for the platform-console venue-type read/write path:
//   - readVenueType (private, exercised via the exported getTenantSummary)
//     must return `null` for an unset or unparseable venue_type — NOT default
//     to "clinic". That default silently mislabelled real accounts (e.g.
//     Inspire, a gym, shown as "clinic" in the console) before this fix.
//   - setTenantVenueType must write venue_type the SAME JSON-encoded way the
//     main app's own getVenueType()/setVenueType() (lib/settings.ts) read and
//     write it, so a read-back — by either path — yields the value that was
//     set, and must reject anything outside {gym, clinic}.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// lib/platform/queries.ts imports lib/db/tenant (getTenantDbById), which
// imports React's server-only `cache` at module load. Under the runner's
// `--conditions=react-server`, npm's react "react-server" entry point is a
// stub that THROWS on load — shim `react` with an identity `cache` BEFORE
// queries.ts (or anything else) is required, so the real code path loads
// unchanged (same issue + fix as analytics.test.ts / db/tenant.test.ts).
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Async IIFE (not top-level await): package.json has no "type":"module", so
// tsx/esbuild compiles .ts to CJS where top-level await is unsupported — same
// reasoning as the other tests in this repo.
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, closeTenantConn } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { settings } = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { getTenantSummary, setTenantVenueType } = requireLocal("./queries") as typeof import("./queries");

  // ── scratch tenant (control row + its own tenant DB file) ────────────────
  const slug = "venuetype-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Venue Type Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    closeTenantConn(dbFile);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    // ── unset → null, never "clinic" ────────────────────────────────────
    // getTenantSummary → readVenueType opens the tenant DB fresh (via
    // getTenantDbById); no settings row exists yet.
    assert.equal(
      getTenantSummary(tid)!.venueType,
      null,
      'unset venue_type reads back as null, not "clinic"',
    );

    // ── unparseable value → null, never "clinic" ────────────────────────
    const tdb = getTenantDbById(tid);
    tdb.insert(settings).values({ key: "venue_type", value: "not-json" }).run();
    assert.equal(
      getTenantSummary(tid)!.venueType,
      null,
      'unparseable venue_type reads back as null, not "clinic"',
    );

    // ── set → returns the real value ────────────────────────────────────
    const gymJson = JSON.stringify("gym");
    tdb
      .insert(settings)
      .values({ key: "venue_type", value: gymJson })
      .onConflictDoUpdate({ target: settings.key, set: { value: gymJson } })
      .run();
    assert.equal(
      getTenantSummary(tid)!.venueType,
      "gym",
      "explicitly-set venue_type reads back as its real value",
    );

    // ── setTenantVenueType: writes so a read-back yields the value ─────────
    setTenantVenueType(tid, "clinic");
    // Read back independently of readVenueType/getTenantSummary — a raw
    // SELECT + JSON.parse, exactly how the app's own getVenueType()/readKey()
    // (lib/settings.ts) reads the row — proves the on-disk shape is the one
    // the rest of the app expects.
    const raw = tdb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "venue_type"))
      .get();
    assert.equal(
      raw && JSON.parse(raw.value),
      "clinic",
      "setTenantVenueType writes JSON-encoded exactly the way getVenueType() reads it",
    );
    assert.equal(
      getTenantSummary(tid)!.venueType,
      "clinic",
      "setTenantVenueType's write is visible via getTenantSummary",
    );

    // Flips cleanly on a second call (proves the upsert path, not just
    // insert-when-absent — the realistic case: an admin correcting a
    // previously-set value, or toggling gym <-> clinic).
    setTenantVenueType(tid, "gym");
    assert.equal(
      getTenantSummary(tid)!.venueType,
      "gym",
      "setTenantVenueType overwrites an existing value",
    );

    // ── validation: rejects anything outside {gym, clinic} ────────────────
    assert.throws(
      () => setTenantVenueType(tid, "bogus" as unknown as "gym"),
      /Invalid venue type/,
      "setTenantVenueType rejects a venue type outside {gym,clinic}",
    );

    console.log("platform/queries.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
