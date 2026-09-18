// Run: npm test -- src/lib/platform/people.test.ts
//
// Platform Console v2, slice 2 (People). The rules that must hold however
// this module is called:
//
//   - listTenantPeople reports role, membership vs account state, live
//     session count SCOPED TO THIS BUSINESS, pending invites and open
//     resets;
//   - a business can never be left with no admin who can sign in: the last
//     admin can be neither demoted nor revoked;
//   - revoking access ends that person's sessions in this business and
//     leaves their sessions elsewhere alone;
//   - transferOwnership makes exactly one admin;
//   - inviting an address that already has an account adds them instead of
//     creating a second account, and re-inviting a revoked member restores
//     them rather than erroring.
//
// The email-sending paths (inviteToTenant for a NEW person, startPasswordReset)
// are not exercised: no provider is configured here. Their pure parts are.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in people.test.ts"); } };
  }
  if (request === "next/headers") {
    return { cookies: () => { throw new Error("no request scope"); }, headers: () => { throw new Error("no request scope"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const people = requireLocal("./people") as typeof import("./people");

  const mkTenant = (slug: string) =>
    (
      controlSqlite
        .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
        .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }
    ).id;
  const mkUser = (email: string) =>
    (
      controlSqlite
        .prepare("INSERT INTO users (email, name, password_hash, role, is_active) VALUES (?, ?, 'x', 'staff', 1) RETURNING id")
        .get(email, email) as { id: number }
    ).id;
  const addMember = (userId: number, tenantId: number, role: string) =>
    controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, ?, 1)").run(userId, tenantId, role);
  const mkSession = (id: string, userId: number, tenantId: number) =>
    controlSqlite
      .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)")
      .run(id, userId, tenantId, Date.now() + 3_600_000);
  const sessionCount = (userId: number, tenantId: number) =>
    (
      controlSqlite
        .prepare("SELECT count(*) AS n FROM auth_sessions WHERE user_id = ? AND active_tenant_id = ?")
        .get(userId, tenantId) as { n: number }
    ).n;

  const tid = mkTenant("people-test-main");
  const otherTid = mkTenant("people-test-other");
  const boss = mkUser("people-boss@test.local");
  const coach = mkUser("people-coach@test.local");
  const gone = mkUser("people-gone@test.local");
  addMember(boss, tid, "admin");
  addMember(coach, tid, "staff");
  addMember(gone, tid, "staff");
  addMember(boss, otherTid, "admin"); // the same person, a second business

  const cleanup = () => {
    for (const t of [tid, otherTid]) {
      controlSqlite.prepare("DELETE FROM auth_sessions WHERE active_tenant_id = ?").run(t);
      controlSqlite.prepare("DELETE FROM user_invites WHERE tenant_id = ?").run(t);
      controlSqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(t);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t);
    }
    for (const u of [boss, coach, gone]) {
      controlSqlite.prepare("DELETE FROM user_password_resets WHERE user_id = ?").run(u);
      controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u);
    }
  };

  try {
    // ── the listing ──────────────────────────────────────────────────────
    mkSession("people-test-s1", boss, tid);
    mkSession("people-test-s2", boss, tid);
    mkSession("people-test-s3", boss, otherTid); // another business: must not count here

    let view = people.listTenantPeople(tid);
    assert.equal(view.people.length, 3, "everyone with a membership is listed");
    const byId = new Map(view.people.map((p) => [p.userId, p]));
    assert.equal(byId.get(boss)!.role, "admin");
    assert.equal(byId.get(coach)!.role, "staff");
    assert.equal(byId.get(boss)!.activeSessions, 2, "sessions are counted for THIS business only");
    assert.equal(byId.get(coach)!.activeSessions, 0);
    assert.ok(byId.get(boss)!.membershipActive && byId.get(boss)!.accountActive);
    assert.equal(view.invites.length, 0);
    assert.equal(view.resets.length, 0);

    // ── the last admin is protected, both ways ───────────────────────────
    const demoteLast = people.setTenantRole(tid, boss, "staff");
    assert.equal(demoteLast.ok, false, "the only admin cannot be demoted");
    assert.match(demoteLast.ok ? "" : demoteLast.error, /only admin/i);
    const revokeLast = people.setTenantAccess(tid, boss, false);
    assert.equal(revokeLast.ok, false, "the only admin cannot have access revoked");
    assert.equal(people.listTenantPeople(tid).people.find((p) => p.userId === boss)!.role, "admin", "…and nothing changed");

    // With a second admin, the first can step down.
    assert.ok(people.setTenantRole(tid, coach, "admin").ok, "a staff member can be promoted");
    assert.ok(people.setTenantRole(tid, boss, "staff").ok, "now the original admin can step down");
    assert.equal(people.listTenantPeople(tid).people.find((p) => p.userId === boss)!.role, "staff");
    assert.ok(people.setTenantRole(tid, boss, "admin").ok); // put it back for the rest

    // ── revoking ends sessions here, and only here ───────────────────────
    mkSession("people-test-s4", coach, tid);
    mkSession("people-test-s5", boss, otherTid);
    assert.equal(sessionCount(coach, tid), 1);
    const revoked = people.setTenantAccess(tid, coach, false);
    assert.ok(revoked.ok, "a non-last admin can be revoked");
    assert.equal(sessionCount(coach, tid), 0, "their sessions in this business are ended");
    assert.equal(sessionCount(boss, otherTid), 2, "sessions in another business are untouched");

    view = people.listTenantPeople(tid);
    assert.equal(view.people.find((p) => p.userId === coach)!.membershipActive, false, "revoked access shows as revoked");
    assert.equal(view.people.find((p) => p.userId === coach)!.accountActive, true, "…but the account itself still exists");

    // Restoring works, and is what a re-invite of a revoked member does too.
    assert.ok(people.setTenantAccess(tid, coach, true).ok);
    const reinvite = await people.inviteToTenant({
      tenantId: tid,
      email: "people-gone@test.local",
      role: "staff",
      invitedByUserId: boss,
      inviterName: "Boss",
    });
    assert.equal(reinvite.ok, false, "inviting someone who already has access is refused, not duplicated");

    people.setTenantAccess(tid, gone, false);
    const restored = await people.inviteToTenant({
      tenantId: tid,
      email: "people-gone@test.local",
      role: "admin",
      invitedByUserId: boss,
      inviterName: "Boss",
    });
    assert.ok(restored.ok, "re-inviting a revoked member restores them");
    const goneRow = people.listTenantPeople(tid).people.find((p) => p.userId === gone)!;
    assert.equal(goneRow.membershipActive, true);
    assert.equal(goneRow.role, "admin", "…at the role they were re-invited as");

    // An address with an existing account is ADDED, never given a second account.
    const before = (controlSqlite.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
    const added = await people.inviteToTenant({
      tenantId: otherTid,
      email: "people-coach@test.local",
      role: "staff",
      invitedByUserId: boss,
      inviterName: "Boss",
    });
    assert.ok(added.ok);
    assert.match(added.ok ? (added.note ?? "") : "", /existing account/i);
    assert.equal((controlSqlite.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n, before, "no second account was created");

    // ── ownership transfer leaves exactly one admin ──────────────────────
    const transfer = people.transferOwnership(tid, coach);
    assert.ok(transfer.ok, `transfer succeeds: ${transfer.ok ? "" : transfer.error}`);
    const after = people.listTenantPeople(tid).people;
    const admins = after.filter((p) => p.role === "admin");
    assert.deepEqual(admins.map((a) => a.userId), [coach], "exactly one admin, and it is the new owner");
    assert.ok(after.filter((p) => p.userId !== coach).every((p) => p.role === "staff"), "everyone else is staff");

    // ── refusals for people who are not members ──────────────────────────
    const stranger = mkUser("people-stranger@test.local");
    try {
      assert.equal(people.setTenantRole(tid, stranger, "admin").ok, false, "a non-member has no role to change");
      assert.equal(people.setTenantAccess(tid, stranger, true).ok, false, "a non-member's access cannot be toggled");
      assert.equal(people.revokeTenantSessions(tid, stranger), 0, "a non-member has no sessions to end");
      assert.equal(people.transferOwnership(tid, stranger).ok, false, "a non-member cannot be made the owner");
    } finally {
      controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(stranger);
    }

    console.log("people.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
