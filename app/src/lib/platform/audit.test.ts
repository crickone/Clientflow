// Run: npm test -- src/lib/platform/audit.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { recordAudit, listAudit, countAudit, auditActions } = requireLocal("./audit") as typeof import("./audit");

  const email = "audit-test@example.test";
  const cleanup = () => controlSqlite.prepare("DELETE FROM platform_audit WHERE actor_email = ?").run(email);
  cleanup();
  const base = { actorUserId: null, actorEmail: email, actorRole: "owner" as const, tenantId: null };
  recordAudit({ ...base, action: "audit-test.alpha", detail: { x: 1 }, reason: "first" });
  recordAudit({ ...base, action: "audit-test.beta", ok: false, error: "nope" });
  recordAudit({ ...base, action: "audit-test.alpha", detail: { note: "needle" } });

  try {
    const mine = { actorEmail: email };
    assert.equal(countAudit(mine), 3);
    assert.equal(countAudit({ ...mine, action: "audit-test.alpha" }), 2);
    assert.equal(countAudit({ ...mine, ok: false }), 1);
    assert.equal(countAudit({ ...mine, q: "needle" }), 1, "q searches detail and reason");
    assert.equal(countAudit({ ...mine, q: "first" }), 1);
    assert.equal(listAudit({ ...mine, limit: 2 }).length, 2);
    assert.equal(listAudit({ ...mine, limit: 2, offset: 2 }).length, 1, "offset pages");
    const all = listAudit(mine);
    const one = listAudit({ id: all[1]!.id });
    assert.equal(one.length, 1);
    assert.equal(one[0]!.id, all[1]!.id, "id filter returns exactly that entry");
    assert.equal(listAudit({ id: 999999999 }).length, 0);
    assert.equal(listAudit({ ...mine, limit: 1.7 }).length, 1, "fractional limit floors to 1");
    assert.equal(listAudit({ ...mine, offset: -3 }).length, 3, "negative offset is 0");
    assert.equal(listAudit({ ...mine, limit: NaN }).length, 3, "NaN limit falls back to the default");
    const now = Date.now();
    assert.equal(countAudit({ ...mine, from: now - 60000, to: now + 1000 }), 3);
    assert.equal(countAudit({ ...mine, to: now - 60000 }), 0);
    const actions = auditActions();
    assert.ok(actions.includes("audit-test.alpha") && actions.includes("audit-test.beta"));
    assert.deepEqual(actions, [...actions].sort());
    console.log("audit.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
