// Run: npm test -- src/lib/dashboard/metrics/aiQueries.test.ts
//
// Smoke test: every aiQueries loader once against a scratch tenant with a
// few seeded ai_usage rows and agent runs. ai_usage rows are removed again
// (the tenant delete also cascades them).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("redirect stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../db/control") as typeof import("../../db/control");
  const { runWithTenant } = requireLocal("../../db/tenant") as typeof import("../../db/tenant");
  const { db, schema } = requireLocal("../../db") as typeof import("../../db");
  const q = requireLocal("./aiQueries") as typeof import("./aiQueries");

  const slug = "dashboard-ai-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard AI Test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const DAY = 86_400_000;
  const now = Date.now();
  const ym = q.monthKeyAt(now);
  assert.match(ym, /^\d{4}-\d{2}$/);

  try {
    const ins = controlSqlite.prepare(
      "INSERT INTO ai_usage (tenant_id, yyyymm, agent_key, model, cost_cents, created_at) VALUES (?,?,?,?,?,?)",
    );
    ins.run(t.id, ym, "orchestrator", "claude-sonnet-5-5", 10.5, now);
    ins.run(t.id, ym, "orchestrator", "claude-sonnet-5-5", 4.5, now);
    ins.run(t.id, ym, "carousel", "fal:fal-ai/flux-2-pro", 8, now);
    ins.run(t.id, "1999-01", "blog", "claude-haiku-4-5", 99, now);

    assert.equal(q.spentThisMonth(t.id, ym), 23);
    assert.equal(q.capCents(t.id), 2500);
    assert.equal(q.overAllowance(t.id), false);
    assert.deepEqual(q.usageByAgent(t.id, ym), { orchestrator: 15, carousel: 8 });
    assert.deepEqual(q.usageByModel(t.id, ym).map((m) => m.model), ["claude-sonnet-5-5", "fal:fal-ai/flux-2-pro"]);
    const rows = q.usageRows(t.id, ym);
    assert.equal(rows.length, 3, "other months excluded");
    assert.equal(rows.reduce((s, r) => s + r.cents, 0), 23);

    await runWithTenant(t.id, async () => {
      db.insert(schema.agentRuns).values([
        { id: "r1", conversationId: "c", agentKey: "orchestrator", model: "m", status: "done" },
        { id: "r2", conversationId: "c", agentKey: "orchestrator", model: "m", status: "error" },
        { id: "r3", conversationId: "c", agentKey: "orchestrator", model: "m", status: "done", createdAt: new Date(now - 60 * DAY) },
      ]).run();
      assert.deepEqual(q.agentRunCounts(now - 7 * DAY, now + DAY), { total: 2, errors: 1 });
      assert.deepEqual(q.agentRunCounts(now - 90 * DAY, now - 30 * DAY), { total: 1, errors: 0 });
      assert.deepEqual(q.agentRunCounts(now - 20 * DAY, now - 10 * DAY), { total: 0, errors: 0 });
    });
    console.log("aiQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
