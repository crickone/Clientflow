// Run: npm test -- src/lib/ai/usage.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  recordUsage,
  getMonthlyUsageCents,
  getMonthlyUsageByAgent,
  getMonthlyUsageByModel,
  assertUnderCap,
  AiCapError,
  MONTHLY_CAP_CENTS,
  getTenantCapCents,
  setTenantCapCents,
  MIN_CAP_CENTS,
  MAX_CAP_CENTS,
} from "./usage";
import { MODELS } from "./client";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as apiKeys.test.ts).
(async () => {
  // ── scratch tenant (control row only) ──
  // ai_usage.tenant_id REFERENCES tenants(id) and control.ts runs with
  // `foreign_keys = ON`, so a bare made-up tenant id would fail on insert —
  // create a real (throwaway) tenant row instead, same as apiKeys.test.ts.
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'aiusage-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('aiusage-test','AI Usage Test','tenants/aiusage-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // clean slate for this (brand-new) scratch tenant
    assert.equal(getMonthlyUsageCents(tid), 0, "no usage recorded yet");
    assert.doesNotThrow(() => assertUnderCap(tid), "0 spend is under the cap");

    // 1,000,000 output tokens on sonnet ($15/1M out, list price) -> 1500c
    recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 1_000_000 });
    const afterFirst = getMonthlyUsageCents(tid);
    assert.ok(Math.abs(afterFirst - 1500) < 0.01, `expected ~1500c, got ${afterFirst}`);
    assert.doesNotThrow(() => assertUnderCap(tid), "1500c is under the $25 cap");

    // +1,000,000 output tokens again -> +1500c = 3000c, at/over MONTHLY_CAP_CENTS (2500)
    recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 1_000_000 });
    const afterSecond = getMonthlyUsageCents(tid);
    assert.ok(
      afterSecond >= MONTHLY_CAP_CENTS,
      `expected >= ${MONTHLY_CAP_CENTS}c, got ${afterSecond}`,
    );
    assert.throws(() => assertUnderCap(tid), AiCapError, "at/over cap throws AiCapError");

    // per-agent breakdown: both calls were 'sales', so it owns the whole total
    const byAgent = getMonthlyUsageByAgent(tid);
    assert.equal(Object.keys(byAgent).length, 1);
    assert.ok(
      Math.abs(byAgent.sales - afterSecond) < 0.01,
      `expected sales bucket ~${afterSecond}c, got ${byAgent.sales}`,
    );

    // a different agent_key is tracked as its own bucket: 1,000,000 input
    // tokens on haiku ($1/1M in, list price) -> 100c
    recordUsage(tid, "assistant", MODELS.haiku, { inputTokens: 1_000_000, outputTokens: 0 });
    const byAgent2 = getMonthlyUsageByAgent(tid);
    assert.equal(Object.keys(byAgent2).length, 2);
    assert.ok(
      Math.abs(byAgent2.assistant - 100) < 0.01,
      `expected assistant bucket ~100c, got ${byAgent2.assistant}`,
    );

    // per-model breakdown: the two 'sales' calls (both sonnet) collapse into
    // one model bucket, the 'assistant'/haiku call is its own — grouped by
    // model instead of agent_key, over the SAME rows. It must reconcile to
    // the tenant total (no double-count) and sort by cents desc.
    const byModel = getMonthlyUsageByModel(tid);
    const totalNow = getMonthlyUsageCents(tid);
    assert.equal(byModel.length, 2, "two distinct models seeded (sonnet, haiku)");
    const sonnetRow = byModel.find((r) => r.model === MODELS.sonnet);
    const haikuRow = byModel.find((r) => r.model === MODELS.haiku);
    assert.ok(
      sonnetRow && Math.abs(sonnetRow.cents - afterSecond) < 0.01,
      `expected sonnet bucket ~${afterSecond}c, got ${sonnetRow?.cents}`,
    );
    assert.ok(
      haikuRow && Math.abs(haikuRow.cents - 100) < 0.01,
      `expected haiku bucket ~100c, got ${haikuRow?.cents}`,
    );
    const sumByModel = byModel.reduce((s, r) => s + r.cents, 0);
    assert.ok(
      Math.abs(sumByModel - totalNow) < 0.01,
      `by-model sum (${sumByModel}) must equal the tenant total (${totalNow}) — no double-count`,
    );
    assert.ok(byModel[0].cents >= byModel[1].cents, "sorted by cents desc");

    // yyyymm buckets are independent: an unrelated historical month has no spend
    assert.equal(getMonthlyUsageCents(tid, "2020-01"), 0);

    console.log("ai/usage.test.ts: all assertions passed");
  } finally {
    cleanup();
  }

  // ── Batch 3bc (C4): per-tenant cap override ──
  // Own scratch tenant (separate from the one above) so this block's cap
  // manipulation can't interact with the default-cap assertions already
  // proven against `tid`.
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'aiusage-cap-test'").run();
  const t2 = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('aiusage-cap-test','AI Cap Test','tenants/aiusage-cap-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid2 = t2.id;
  const cleanup2 = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid2);
    controlSqlite.prepare("DELETE FROM tenant_ai_cap WHERE tenant_id = ?").run(tid2);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid2);
  };

  try {
    // Unset -> assertUnderCap falls back to the DEFAULT MONTHLY_CAP_CENTS.
    assert.equal(getTenantCapCents(tid2), MONTHLY_CAP_CENTS, "no tenant_ai_cap row -> reads the default");

    // Same math the top-of-file test already proved: 1,000,000 sonnet output
    // tokens -> ~1500c — comfortably under the $25 default, nowhere near it.
    recordUsage(tid2, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 1_000_000 });
    const spend = getMonthlyUsageCents(tid2);
    assert.ok(spend > 0 && spend < MONTHLY_CAP_CENTS, `expected spend under the ${MONTHLY_CAP_CENTS}c default, got ${spend}`);
    assert.doesNotThrow(() => assertUnderCap(tid2), "spend under the DEFAULT cap doesn't throw");

    // Configuring a cap BELOW that spend trips it — even though the tenant is
    // nowhere near the $25 default. This is the whole point of C4: the cap is
    // no longer one hardcoded number for every tenant.
    setTenantCapCents(tid2, MIN_CAP_CENTS); // €1 — comfortably below ~$15 of spend
    assert.equal(getTenantCapCents(tid2), MIN_CAP_CENTS, "configured cap is read back verbatim");
    assert.throws(() => assertUnderCap(tid2), AiCapError, "spend over the CONFIGURED (low) cap throws");

    // Raising the cap back above spend clears the trip — proves assertUnderCap
    // re-reads the live configured value every call, not a cached snapshot.
    setTenantCapCents(tid2, MONTHLY_CAP_CENTS);
    assert.doesNotThrow(() => assertUnderCap(tid2), "raising the cap again un-trips it");

    // setTenantCapCents validates bounds itself — the SAME guarantee for
    // every caller (admin action, script, test), not just the UI layer.
    assert.throws(() => setTenantCapCents(tid2, 0), "0 rejected — below MIN_CAP_CENTS");
    assert.throws(() => setTenantCapCents(tid2, MAX_CAP_CENTS + 1), "above MAX_CAP_CENTS rejected");
    assert.throws(() => setTenantCapCents(tid2, 150.5), "non-integer cents rejected");

    console.log("ai/usage.test.ts: per-tenant cap assertions passed");
  } finally {
    cleanup2();
  }
})();
