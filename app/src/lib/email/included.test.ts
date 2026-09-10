// Run: npm test -- src/lib/email/included.test.ts
//
// The monthly included-sends tranche — the reason a small client can send
// campaigns forever without ever topping up. Covers:
//   1. the allowance read-through: global default, per-tenant override, and
//      clearing an override;
//   2. splitBillable — free/billable split, that it is PURE (a quote can be
//      taken twice without consuming anything), and the straddling case;
//   3. recordSent accumulating, including that free sends still consume the
//      allowance (or it would never run out);
//   4. the calendar reset: usage is bucketed per month, so a new month starts
//      with the full allowance.
//
// NOTE: plain node:assert/strict via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { currentMonthKey } = requireLocal("../monthlyCap") as typeof import("../monthlyCap");
  const {
    DEFAULT_EMAIL_INCLUDED_PER_MONTH,
    clearTenantIncludedSends,
    getEmailIncludedPerMonth,
    getSentThisMonth,
    getTenantIncludedSends,
    includedRemaining,
    recordSent,
    setTenantIncludedSends,
    splitBillable,
  } = requireLocal("./included") as typeof import("./included");

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'included-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('included-test','Included Test','tenants/included-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    for (const tbl of ["email_usage", "tenant_email_included"])
      controlSqlite.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // ── 1. the allowance ──
    assert.equal(DEFAULT_EMAIL_INCLUDED_PER_MONTH, 5000, "5,000 sends a month with the base plan");
    assert.equal(getEmailIncludedPerMonth(), DEFAULT_EMAIL_INCLUDED_PER_MONTH);
    assert.equal(getTenantIncludedSends(tid), DEFAULT_EMAIL_INCLUDED_PER_MONTH, "no override = the global");

    setTenantIncludedSends(tid, 100);
    assert.equal(getTenantIncludedSends(tid), 100, "a per-tenant override wins");
    clearTenantIncludedSends(tid);
    assert.equal(getTenantIncludedSends(tid), DEFAULT_EMAIL_INCLUDED_PER_MONTH, "cleared = back to the global");
    setTenantIncludedSends(tid, 100);

    assert.throws(() => setTenantIncludedSends(tid, -1), /whole number/);
    assert.throws(() => setTenantIncludedSends(tid, 1.5), /whole number/);

    // ── 2. splitBillable is a pure quote — calling it never consumes ──
    assert.equal(getSentThisMonth(tid), 0);
    assert.deepEqual(splitBillable(tid, 40), { free: 40, billable: 0 });
    assert.deepEqual(splitBillable(tid, 40), { free: 40, billable: 0 }, "quoting twice changes nothing");
    assert.equal(includedRemaining(tid), 100);

    // A send larger than the whole allowance straddles the boundary.
    assert.deepEqual(splitBillable(tid, 250), { free: 100, billable: 150 });
    assert.deepEqual(splitBillable(tid, 0), { free: 0, billable: 0 });
    assert.throws(() => splitBillable(tid, -1), /non-negative/);

    // ── 3. recordSent consumes — FREE sends included ──
    recordSent(tid, 40);
    assert.equal(getSentThisMonth(tid), 40);
    assert.equal(includedRemaining(tid), 60, "free sends still consume the allowance");
    assert.deepEqual(splitBillable(tid, 100), { free: 60, billable: 40 });

    recordSent(tid, 60);
    assert.equal(includedRemaining(tid), 0, "the allowance is now spent");
    assert.deepEqual(splitBillable(tid, 10), { free: 0, billable: 10 }, "everything is billable from here");

    // Over-run: the counter keeps climbing past the allowance (reporting
    // needs the true number, not one clamped at the tranche).
    recordSent(tid, 500);
    assert.equal(getSentThisMonth(tid), 600);
    assert.equal(includedRemaining(tid), 0, "remaining never goes negative");
    recordSent(tid, 0);
    assert.equal(getSentThisMonth(tid), 600, "a zero/invalid count is a no-op");

    // ── 4. the calendar reset. Usage is keyed by month, so last month's
    // spend can't eat this month's allowance. ──
    controlSqlite
      .prepare("UPDATE email_usage SET yyyymm = '2000-01' WHERE tenant_id = ? AND yyyymm = ?")
      .run(tid, currentMonthKey());
    assert.equal(getSentThisMonth(tid), 0, "a new month has no row yet");
    assert.equal(includedRemaining(tid), 100, "and the full allowance is back");

    console.log("email/included.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
