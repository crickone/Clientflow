// Run: npm test -- src/lib/research/spend.test.ts
//
// Task 3 (Market Research P1) unit tests for the per-tenant monthly
// research-spend meter + cap. Mirrors ai/usage.test.ts's shape (scratch
// control-plane tenant row, no mocking needed — controlSqlite is a real
// SQLite connection) since spend.ts only touches controlSqlite directly,
// never the tenant `db` proxy — so it never hits the react-server `cache()`
// chain that forces forms.test.ts/store.test.ts's `Module._load` shim.
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  ResearchCapError,
  UNIT_COST_CENTS,
  DEFAULT_RESEARCH_CAP_CENTS,
  getResearchCapCents,
  researchSpentCents,
  assertUnderResearchCap,
  recordResearchSpend,
} from "./spend";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as ai/usage.test.ts).
(async () => {
  // ════════════════════════════════════════════════════════════════════
  // UNIT_COST_CENTS — sanity: whole cents, roughly matches the documented
  // Google list-price estimates (details in spend.ts's comment).
  // ════════════════════════════════════════════════════════════════════
  assert.ok(Number.isInteger(UNIT_COST_CENTS.geocode), "geocode unit cost is an integer");
  assert.ok(Number.isInteger(UNIT_COST_CENTS.nearby), "nearby unit cost is an integer");
  assert.ok(Number.isInteger(UNIT_COST_CENTS.details), "details unit cost is an integer");
  assert.ok(UNIT_COST_CENTS.geocode > 0, "geocode unit cost is positive");
  assert.ok(UNIT_COST_CENTS.nearby > UNIT_COST_CENTS.details, "nearby ($32/1k) costs more than details ($17/1k)");
  assert.ok(UNIT_COST_CENTS.details > UNIT_COST_CENTS.geocode, "details ($17/1k) costs more than geocode ($5/1k)");
  assert.equal(UNIT_COST_CENTS.adlib, 0, "Meta Ad Library (Market Research P2) is a free API -- 0c/call");

  // ── scratch tenant (control row only) ──
  // research_usage.tenant_id REFERENCES tenants(id) and control.ts runs with
  // `foreign_keys = ON`, so a bare made-up tenant id would fail on insert —
  // create a real (throwaway) tenant row instead, same as ai/usage.test.ts.
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'research-spend-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('research-spend-test','Research Spend Test','tenants/research-spend-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM research_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenant_research_cap WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // clean slate for this (brand-new) scratch tenant
    assert.equal(researchSpentCents(tid), 0, "no spend recorded yet");
    assert.doesNotThrow(() => assertUnderResearchCap(tid), "0 spend is under the cap");

    // default cap = 1000 (€10) when no per-tenant override row exists
    assert.equal(getResearchCapCents(tid), 1000, "default cap is 1000c (€10)");
    assert.equal(getResearchCapCents(tid), DEFAULT_RESEARCH_CAP_CENTS, "matches the exported default constant");

    // record accumulates WITHIN a month (upsert into the current month's row)
    recordResearchSpend(tid, UNIT_COST_CENTS.nearby, "nearby");
    assert.equal(researchSpentCents(tid), UNIT_COST_CENTS.nearby, "first call recorded");
    recordResearchSpend(tid, UNIT_COST_CENTS.details, "details");
    const afterTwo = researchSpentCents(tid);
    assert.equal(
      afterTwo,
      UNIT_COST_CENTS.nearby + UNIT_COST_CENTS.details,
      "second call accumulates onto the same month's total, not overwrite",
    );
    assert.doesNotThrow(() => assertUnderResearchCap(tid), "still comfortably under the 1000c default cap");

    // different tenants isolated: a second scratch tenant starts at 0 and is
    // unaffected by the first tenant's spend above.
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'research-spend-test-2'").run();
    const t2 = controlSqlite
      .prepare(
        "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('research-spend-test-2','Research Spend Test 2','tenants/research-spend-test-2/void.db',1) RETURNING id",
      )
      .get() as { id: number };
    const tid2 = t2.id;
    try {
      assert.equal(researchSpentCents(tid2), 0, "a different tenant has its own, zeroed bucket");
      recordResearchSpend(tid2, 999, "geocode");
      assert.equal(researchSpentCents(tid2), 999, "tenant 2's spend recorded");
      assert.equal(researchSpentCents(tid), afterTwo, "tenant 1's total is unaffected by tenant 2's recordResearchSpend");
    } finally {
      controlSqlite.prepare("DELETE FROM research_usage WHERE tenant_id = ?").run(tid2);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid2);
    }

    // negative cents clamped to 0 — recording a negative amount must NOT
    // reduce the running total (proves the clamp applies to the incoming
    // delta, not just a floor on the stored total).
    recordResearchSpend(tid, -500, "geocode");
    assert.equal(researchSpentCents(tid), afterTwo, "a negative recordResearchSpend call is a no-op (clamped to 0), total unchanged");

    // a fresh tenant recording ONLY a negative amount lands at exactly 0, never negative.
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'research-spend-test-neg'").run();
    const t3 = controlSqlite
      .prepare(
        "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('research-spend-test-neg','Research Spend Negative Test','tenants/research-spend-test-neg/void.db',1) RETURNING id",
      )
      .get() as { id: number };
    const tid3 = t3.id;
    try {
      recordResearchSpend(tid3, -50, "geocode");
      assert.equal(researchSpentCents(tid3), 0, "negative-only spend clamps to exactly 0, never negative");
    } finally {
      controlSqlite.prepare("DELETE FROM research_usage WHERE tenant_id = ?").run(tid3);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid3);
    }

    // push tid at/over the (lowered, for test speed) cap: set a per-tenant
    // override BELOW the current spend, proving assertUnderResearchCap reads
    // the live cap, and trips at >= not just >.
    controlSqlite
      .prepare(
        "INSERT INTO tenant_research_cap (tenant_id, cap_cents) VALUES (?, ?) ON CONFLICT(tenant_id) DO UPDATE SET cap_cents = excluded.cap_cents",
      )
      .run(tid, afterTwo);
    assert.equal(getResearchCapCents(tid), afterTwo, "configured per-tenant cap is read back verbatim");
    assert.throws(() => assertUnderResearchCap(tid), ResearchCapError, "spend AT the (configured) cap throws ResearchCapError");

    // raising the cap back above spend un-trips it — proves the check re-reads
    // the live cap every call, not a cached snapshot.
    controlSqlite
      .prepare(
        "INSERT INTO tenant_research_cap (tenant_id, cap_cents) VALUES (?, ?) ON CONFLICT(tenant_id) DO UPDATE SET cap_cents = excluded.cap_cents",
      )
      .run(tid, afterTwo + 1000);
    assert.doesNotThrow(() => assertUnderResearchCap(tid), "raising the cap again un-trips it");

    // pushing spend strictly OVER a cap also throws (not just AT it)
    controlSqlite
      .prepare(
        "INSERT INTO tenant_research_cap (tenant_id, cap_cents) VALUES (?, ?) ON CONFLICT(tenant_id) DO UPDATE SET cap_cents = excluded.cap_cents",
      )
      .run(tid, 10);
    recordResearchSpend(tid, 1000, "details");
    assert.throws(() => assertUnderResearchCap(tid), ResearchCapError, "spend OVER the cap throws ResearchCapError");

    // a different month key reads as 0 spent, regardless of this month's total
    assert.equal(researchSpentCents(tid, "2020-01"), 0, "an unrelated historical month has no spend");
    assert.ok(researchSpentCents(tid) > 0, "sanity: the current month's total is still non-zero");

    console.log("research/spend.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
