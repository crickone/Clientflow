// Run: npm test -- src/lib/platform/access.test.ts
import assert from "node:assert/strict";

import { controlSqlite } from "../db/control";
import { grantAdminMembership } from "./access";

// Scratch user + tenant, isolated by a distinctive email/slug + cleaned up below.
controlSqlite.prepare("DELETE FROM users WHERE email = 'open-access-test@x.ie'").run();
controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'open-access-test'").run();

const u = controlSqlite
  .prepare(
    "INSERT INTO users (email, password_hash) VALUES ('open-access-test@x.ie', 'x') RETURNING id",
  )
  .get() as { id: number };
const t = controlSqlite
  .prepare(
    "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('open-access-test','Open Access Test','tenants/open-access-test/void.db',1) RETURNING id",
  )
  .get() as { id: number };

const membershipRow = () =>
  controlSqlite
    .prepare("SELECT role, is_active FROM memberships WHERE user_id = ? AND tenant_id = ?")
    .get(u.id, t.id) as { role: string; is_active: number } | undefined;
const membershipCount = () =>
  (
    controlSqlite
      .prepare("SELECT COUNT(*) c FROM memberships WHERE user_id = ? AND tenant_id = ?")
      .get(u.id, t.id) as { c: number }
  ).c;

try {
  // No membership yet.
  assert.equal(membershipRow(), undefined, "no membership before the first grant");

  // First call: nothing existed → inserts a new, active admin membership.
  const first = grantAdminMembership(t.id, u.id);
  assert.equal(first.granted, true, "first call grants a new admin membership");
  assert.deepEqual(membershipRow(), { role: "admin", is_active: 1 });

  // Second call: idempotent — still exactly one row, reported as not newly granted.
  const second = grantAdminMembership(t.id, u.id);
  assert.equal(second.granted, false, "second call is idempotent (already a member)");
  assert.equal(membershipCount(), 1, "still exactly one membership row");
  assert.deepEqual(membershipRow(), { role: "admin", is_active: 1 });

  // An existing (non-admin / inactive) membership for this pair is left
  // completely untouched — ON CONFLICT DO NOTHING must never promote or
  // reactivate it. "Open business" grants access when there is none; it must
  // never silently escalate an existing relationship.
  controlSqlite
    .prepare("UPDATE memberships SET role = 'staff', is_active = 0 WHERE user_id = ? AND tenant_id = ?")
    .run(u.id, t.id);
  const third = grantAdminMembership(t.id, u.id);
  assert.equal(third.granted, false, "an existing membership is never re-granted");
  assert.deepEqual(
    membershipRow(),
    { role: "staff", is_active: 0 },
    "existing membership's role/active state is left untouched",
  );

  console.log("platform/access.test.ts: all assertions passed");
} finally {
  controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?").run(u.id, t.id);
  controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
}
