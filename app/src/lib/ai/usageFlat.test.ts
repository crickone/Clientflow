import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  recordFlatUsage,
  meterAndChargeFlat,
  getMonthlyUsageCents,
  getMonthlyUsageByAgent,
  getMonthlyUsageByModel,
} from "./usage";

(async () => {
  // Scratch tenant — ai_usage.tenant_id has an FK, so use a real throwaway
  // tenant row (same pattern as usage.test.ts / apiKeys.test.ts).
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'aiflat-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('aiflat-test','AI Flat Test','tenants/aiflat-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    assert.equal(getMonthlyUsageCents(tid), 0, "clean slate");

    // recordFlatUsage: cost lands verbatim, all four token columns are 0.
    const cost = recordFlatUsage(tid, "carousel", "fal:flux-1.1-pro", 4);
    assert.equal(cost, 4, "returns the cost it recorded");
    assert.equal(getMonthlyUsageCents(tid), 4, "flat cost counted in the monthly total");
    const row = controlSqlite
      .prepare(
        "SELECT input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_cents, model, agent_key FROM ai_usage WHERE tenant_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(tid) as {
      input_tokens: number; output_tokens: number; cache_read_tokens: number;
      cache_create_tokens: number; cost_cents: number; model: string; agent_key: string;
    };
    assert.equal(row.input_tokens, 0);
    assert.equal(row.output_tokens, 0);
    assert.equal(row.cache_read_tokens, 0);
    assert.equal(row.cache_create_tokens, 0);
    assert.equal(row.cost_cents, 4);
    assert.equal(row.model, "fal:flux-1.1-pro");
    assert.equal(row.agent_key, "carousel");

    // Existing rollups include the flat row with no changes.
    assert.equal(getMonthlyUsageByAgent(tid).carousel, 4);
    assert.ok(
      getMonthlyUsageByModel(tid).some((m) => m.model === "fal:flux-1.1-pro" && m.cents === 4),
      "per-model breakdown row present",
    );

    // meterAndChargeFlat inside the free tranche: records spend, debits no credits
    // (billable overflow is 0 — identical tranche math to meterAndCharge).
    meterAndChargeFlat(tid, "carousel", "fal:flux-1.1-pro", 4);
    assert.equal(getMonthlyUsageCents(tid), 8, "second flat call recorded");

    console.log("usageFlat.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
