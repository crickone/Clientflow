// Run: npm test -- src/lib/platform/tenantMeta.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { defaultStage, getTenantMeta, setTenantMeta } = requireLocal("./tenantMeta") as typeof import("./tenantMeta");

  const base = { archived: false, billingStatus: "active", exempt: false, setupRequiredDone: 4, setupRequiredTotal: 4, riskScore: 10 };
  assert.equal(defaultStage(base), "active");
  assert.equal(defaultStage({ ...base, archived: true }), "churned");
  assert.equal(defaultStage({ ...base, billingStatus: "cancelled" }), "churned");
  assert.equal(defaultStage({ ...base, billingStatus: "pending_payment" }), "trial");
  assert.equal(defaultStage({ ...base, setupRequiredDone: 2 }), "onboarding");
  assert.equal(defaultStage({ ...base, riskScore: 65 }), "at_risk");
  assert.equal(defaultStage({ ...base, exempt: true, billingStatus: null }), "active", "an agency account with setup done is active");

  const slug = "meta-test";
  const email = "meta-test-user@example.invalid";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(email);
  const u = controlSqlite.prepare("INSERT INTO users (email, password_hash) VALUES (?, 'x') RETURNING id").get(email) as { id: number };
  const t = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, 'Meta Test', ?, 1) RETURNING id").get(slug, `tenants/${slug}/void.db`) as { id: number };
  try {
    let m = getTenantMeta(t.id, base);
    assert.equal(m.stage, null);
    assert.equal(m.stageAuto, "active");
    assert.deepEqual(m.tags, []);
    setTenantMeta(t.id, { stage: "at_risk", tags: ["vip", " VIP ", "", "slow-payer"] });
    m = getTenantMeta(t.id, base);
    assert.equal(m.stage, "at_risk");
    assert.deepEqual(m.tags, ["vip", "slow-payer"], "tags are trimmed, lowercased, deduplicated");
    setTenantMeta(t.id, { ownerUserId: u.id });
    m = getTenantMeta(t.id, base);
    assert.equal(m.ownerUserId, u.id);
    assert.equal(m.stage, "at_risk", "a partial patch leaves other fields alone");
    setTenantMeta(t.id, { stage: null });
    assert.equal(getTenantMeta(t.id, base).stage, null);
    console.log("tenantMeta.test.ts: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM tenant_meta WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  }
})().catch((e) => { console.error(e); process.exit(1); });
