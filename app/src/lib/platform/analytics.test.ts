// Run: npm test -- src/lib/platform/analytics.test.ts
//
// Light integration test: exercises getPlatformAnalytics() against the REAL dev
// control.db + heterogeneous tenant DBs and asserts the wire shape is
// well-formed. It must NOT throw even though tenant DBs differ (renova is a
// clinic; fresh gyms are near-empty) — that resilience is the whole point.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// getTenantDbById lives in lib/db/tenant, which imports React's server-only
// `cache` at module load. Under the runner's `--conditions=react-server`, npm's
// react "react-server" entry point is a stub that THROWS on load (it only works
// inside Next's server runtime). Shim `react` with an identity `cache` so the
// REAL analytics code path can load unchanged. Installed BEFORE analytics is
// required; production code (and tenant.ts) is untouched.
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
  const { getPlatformAnalytics } =
    requireLocal("./analytics") as typeof import("./analytics");

  // Does not throw despite heterogeneous tenant DBs.
  const a = getPlatformAnalytics();

  const finiteNonNeg = (n: unknown, label: string) => {
    assert.equal(typeof n, "number", `${label} is a number`);
    assert.ok(Number.isFinite(n as number), `${label} is finite`);
    assert.ok((n as number) >= 0, `${label} is >= 0`);
  };

  finiteNonNeg(a.generatedAt, "generatedAt");

  // Platform block.
  const p = a.platform;
  finiteNonNeg(p.mrrCents, "platform.mrrCents");
  finiteNonNeg(p.arrCents, "platform.arrCents");
  assert.equal(p.arrCents, p.mrrCents * 12, "arr = mrr * 12");
  for (const k of ["total", "active", "pastDue", "suspended", "pendingPayment", "cancelled", "exempt", "paying"] as const) {
    finiteNonNeg(p.gyms[k], `platform.gyms.${k}`);
  }

  // 12-month, zero-filled, continuous chart series.
  assert.equal(p.collectedByMonth.length, 12, "collectedByMonth has 12 months");
  assert.equal(p.gymsByMonth.length, 12, "gymsByMonth has 12 months");
  for (const row of p.collectedByMonth) {
    assert.match(row.month, /^\d{4}-\d{2}$/, "collected month is YYYY-MM");
    finiteNonNeg(row.cents, `collected ${row.month}`);
  }
  let prevTotal = -1;
  for (const row of p.gymsByMonth) {
    assert.match(row.month, /^\d{4}-\d{2}$/, "gyms month is YYYY-MM");
    finiteNonNeg(row.total, `gymsByMonth.total ${row.month}`);
    finiteNonNeg(row.added, `gymsByMonth.added ${row.month}`);
    assert.ok(row.total >= prevTotal, "cumulative total is non-decreasing");
    prevTotal = row.total;
  }

  // Gyms (business figures) block.
  const g = a.gyms;
  for (const k of ["tenantsCounted", "members", "activeMembers", "gmvCentsMonthly", "estResidualCentsMonthly", "revenueCentsThisMonth", "leads", "classesThisWeek"] as const) {
    finiteNonNeg(g[k], `gyms.${k}`);
  }
  assert.ok(Array.isArray(g.perGym), "gyms.perGym is an array");
  assert.equal(g.perGym.length, g.tenantsCounted, "perGym length == tenantsCounted");
  assert.equal(
    g.estResidualCentsMonthly,
    Math.round(g.gmvCentsMonthly * 0.0007),
    "residual == round(gmv * 0.0007)",
  );

  // Per-gym rows are well-formed.
  for (const row of g.perGym) {
    finiteNonNeg(row.tenantId, "perGym.tenantId");
    assert.equal(typeof row.name, "string", "perGym.name is a string");
    assert.equal(typeof row.slug, "string", "perGym.slug is a string");
    // null when that tenant's venue_type was never set — must NOT default to
    // "clinic" (that silently mislabelled real unset accounts, e.g. Inspire,
    // a gym, as a clinic).
    assert.ok(
      row.venueType === null || typeof row.venueType === "string",
      "perGym.venueType is a string or null",
    );
    assert.equal(typeof row.status, "string", "perGym.status is a string");
    assert.equal(typeof row.exempt, "boolean", "perGym.exempt is a boolean");
    for (const k of ["members", "activeMembers", "gmvCentsMonthly", "revenueCentsThisMonth"] as const) {
      finiteNonNeg(row[k], `perGym.${k}`);
    }
  }

  // ── deterministic venueType coverage: set → value, unset → null ─────────
  // The loop above only proves the real dev tenants' rows are well-formed
  // (their set/unset mix isn't guaranteed); scratch tenants pin down the
  // actual set → value / unset → null behaviour deterministically.
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, closeTenantConn } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { settings } = requireLocal("../db/schema") as typeof import("../db/schema");

  const mkScratchTenant = (slug: string, name: string) => {
    const dbFile = `tenants/${slug}/${slug}.db`;
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const row = controlSqlite
      .prepare(
        "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
      )
      .get(slug, name, dbFile) as { id: number };
    return { id: row.id, dbFile };
  };
  const rmScratchTenant = (id: number, slug: string, dbFile: string) => {
    closeTenantConn(dbFile);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const setTenant = mkScratchTenant("analytics-venuetype-set", "Analytics VenueType Set");
  const unsetTenant = mkScratchTenant("analytics-venuetype-unset", "Analytics VenueType Unset");
  try {
    const json = JSON.stringify("gym");
    getTenantDbById(setTenant.id)
      .insert(settings)
      .values({ key: "venue_type", value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json } })
      .run();
    // unsetTenant: opened but never given a venue_type row — getTenantDbById
    // still needs to run once so the tenant DB (+ its `settings` table) exists.
    getTenantDbById(unsetTenant.id);

    const a2 = getPlatformAnalytics();
    const setRow = a2.gyms.perGym.find((r) => r.tenantId === setTenant.id);
    const unsetRow = a2.gyms.perGym.find((r) => r.tenantId === unsetTenant.id);
    assert.ok(setRow, "the explicitly-set scratch tenant appears in perGym");
    assert.ok(unsetRow, "the unset scratch tenant appears in perGym");
    assert.equal(setRow!.venueType, "gym", "perGym.venueType is the real value when set");
    assert.equal(unsetRow!.venueType, null, 'perGym.venueType is null when unset, not "clinic"');
  } finally {
    rmScratchTenant(setTenant.id, "analytics-venuetype-set", setTenant.dbFile);
    rmScratchTenant(unsetTenant.id, "analytics-venuetype-unset", unsetTenant.dbFile);
  }

  console.log("analytics.test.ts: all assertions passed");
})();
