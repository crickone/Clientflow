// Run: npm test -- src/lib/analytics/moduleUsage.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { noteModuleVisit, flushModuleUsage, usageByModule } = requireLocal("./moduleUsage") as typeof import("./moduleUsage");

  const slug = "usage-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, 'Usage Test', ?, 1) RETURNING id").get(slug, `tenants/${slug}/void.db`) as { id: number };
  const day = 86400000;
  const now = Date.UTC(2026, 10, 11, 12);
  try {
    noteModuleVisit(t.id, "/leads", now);
    noteModuleVisit(t.id, "/leads/123", now);
    noteModuleVisit(t.id, "/nutrition/foods", now - 2 * day);
    noteModuleVisit(t.id, "/dashboard", now); // no module owns it: ignored
    noteModuleVisit(t.id, "/leads", now - 40 * day); // previous window
    assert.equal((controlSqlite.prepare("SELECT count(*) AS n FROM module_usage WHERE tenant_id = ?").get(t.id) as { n: number }).n, 0, "nothing written before flush");
    const touched = flushModuleUsage(now);
    assert.equal(touched, 3);
    const u = usageByModule(t.id, 30, now);
    const leads = u.find((m) => m.key === "leads")!;
    assert.equal(leads.hits, 2);
    assert.equal(leads.prevHits, 1);
    assert.equal(leads.lastAt, now);
    assert.equal(u.find((m) => m.key === "nutrition")!.hits, 1);
    assert.equal(u.find((m) => m.key === "workout")!.hits, 0, "every module is listed, used or not");
    assert.equal(flushModuleUsage(now), 0, "flushing twice writes nothing");
    console.log("moduleUsage.test.ts: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM module_usage WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  }
})().catch((e) => { console.error(e); process.exit(1); });
