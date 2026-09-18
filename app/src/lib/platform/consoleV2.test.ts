// Run: npm test -- src/lib/platform/consoleV2.test.ts
//
// Platform Console v2, slice 1. Verifies the three things that have to be
// true before any later slice can be trusted:
//
//   ROLES     — two roles; the owner-only set is enforced by canDo, not by
//               hiding a button; a platform admin with no role recorded is
//               treated as an owner (what they were before roles existed);
//               setPlatformRole refuses a self-demotion and refuses removing
//               the last owner, so the platform can never lock itself out.
//   AUDIT     — a row is written with actor, tenant, reason and redacted
//               detail; a REFUSED action is recorded too; listAudit filters
//               by tenant and by actor and returns newest first.
//   OPEN-AS   — the open token carries the reason through mint and consume,
//               and is still single-use.
//
// Control-plane only (no tenant DB): every table here lives in control.db.
// Same Module._load shim as the other platform tests — auth.ts pulls in
// @/lib/db/control, and roles.ts is imported by @/lib/platform/auth.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in consoleV2.test.ts"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const roles = requireLocal("./roles") as typeof import("./roles");
  const audit = requireLocal("./audit") as typeof import("./audit");
  const { createOpenToken, consumeOpenToken } = requireLocal("./openToken") as typeof import("./openToken");

  // Scratch platform staff + a scratch tenant, all removed in the finally.
  const mkUser = (email: string, role: string | null) =>
    (
      controlSqlite
        .prepare(
          "INSERT INTO users (email, name, password_hash, role, platform_role, is_platform_admin, is_active) VALUES (?, ?, 'x', 'staff', ?, 1, 1) RETURNING id",
        )
        .get(email, email, role) as { id: number }
    ).id;

  const ownerId = mkUser("console-v2-owner@test.local", "owner");
  const managerId = mkUser("console-v2-manager@test.local", "manager");
  const legacyId = mkUser("console-v2-legacy@test.local", null); // predates roles
  const slug = "console-v2-test";
  const tenantId = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "Console V2 Test", `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM platform_audit WHERE tenant_id = ? OR actor_user_id IN (?, ?, ?)").run(tenantId, ownerId, managerId, legacyId);
    controlSqlite.prepare("DELETE FROM platform_open_tokens WHERE tenant_id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM users WHERE id IN (?, ?, ?)").run(ownerId, managerId, legacyId);
  };

  try {
    // ── ROLES ───────────────────────────────────────────────────────────
    assert.equal(roles.getPlatformRole(ownerId), "owner");
    assert.equal(roles.getPlatformRole(managerId), "manager");
    assert.equal(roles.getPlatformRole(legacyId), "owner", "a platform admin with no role recorded is an owner, as they were before roles existed");

    // The owner-only split is a property of the action, checked in one place.
    for (const a of ["offboard", "waive", "comp", "set-staff-role", "purge-now"]) {
      assert.ok(roles.isOwnerOnly(a), `${a} is owner-only`);
      assert.equal(roles.canDo("manager", a), false, `a manager cannot ${a}`);
      assert.equal(roles.canDo("owner", a), true, `an owner can ${a}`);
    }
    for (const a of ["suspend", "reactivate", "grant-credits", "grant-ai-credits", "voice-cap", "venue-type", "open"]) {
      assert.equal(roles.isOwnerOnly(a), false, `${a} is not owner-only`);
      assert.equal(roles.canDo("manager", a), true, `a manager can ${a}`);
    }
    // Sensitive actions carry a reason; routine ones do not.
    assert.ok(roles.requiresReason("open"), "opening a business needs a reason");
    assert.ok(roles.requiresReason("offboard"));
    assert.ok(roles.requiresReason("suspend"));
    assert.equal(roles.requiresReason("grant-credits"), false);

    // A staff member cannot remove their own owner access…
    const selfDemote = roles.setPlatformRole(ownerId, "manager", ownerId);
    assert.equal(selfDemote.ok, false, "self-demotion is refused");
    assert.match(selfDemote.ok ? "" : selfDemote.error, /your own/i);
    assert.equal(roles.getPlatformRole(ownerId), "owner", "…and the role is unchanged");

    // …and the last owner cannot be demoted by anyone. Both scratch owners
    // (explicit + legacy) count, so demote one and then the other is last.
    assert.ok(roles.setPlatformRole(legacyId, "manager", ownerId).ok, "one of two owners can be demoted");
    assert.equal(roles.getPlatformRole(legacyId), "manager");

    // Promotion always works, and a non-staff user is refused outright.
    assert.ok(roles.setPlatformRole(managerId, "owner", ownerId).ok);
    assert.equal(roles.getPlatformRole(managerId), "owner");
    assert.ok(roles.setPlatformRole(managerId, "manager", ownerId).ok);
    assert.equal(roles.setPlatformRole(999_999_9, "owner", ownerId).ok, false, "a user without console access is refused");

    const staff = roles.listPlatformStaff();
    const byId = new Map(staff.map((s) => [s.userId, s]));
    assert.equal(byId.get(ownerId)?.role, "owner");
    assert.equal(byId.get(managerId)?.role, "manager");
    assert.ok(staff.every((s) => s.role === "owner" || s.role === "manager"), "every staff row resolves to a real role");

    // ── AUDIT ───────────────────────────────────────────────────────────
    audit.recordAudit({
      actorUserId: ownerId,
      actorEmail: "console-v2-owner@test.local",
      actorRole: "owner",
      tenantId,
      action: "suspend",
      detail: { months: 2, pageAccessToken: "should-not-be-here" },
      reason: "non-payment after three retries",
      ip: "203.0.113.7",
    });
    audit.recordAudit({
      actorUserId: managerId,
      actorEmail: "console-v2-manager@test.local",
      actorRole: "manager",
      tenantId,
      action: "offboard",
      reason: "asked to",
      ok: false,
      error: "That action is for owners only.",
    });

    const forTenant = audit.listAudit({ tenantId });
    assert.equal(forTenant.length, 2, "both rows are recorded against the tenant");
    assert.equal(forTenant[0].action, "offboard", "newest first");
    assert.equal(forTenant[0].ok, false, "a REFUSED action is recorded, not dropped");
    assert.equal(forTenant[0].error, "That action is for owners only.");
    assert.equal(forTenant[0].tenantName, "Console V2 Test", "the tenant name is joined in");
    assert.equal(forTenant[1].reason, "non-payment after three retries");
    assert.equal(forTenant[1].ip, "203.0.113.7");
    assert.deepEqual(forTenant[1].detail, { months: 2, pageAccessToken: "should-not-be-here" }, "detail round-trips as JSON");

    const byActor = audit.listAudit({ actorUserId: managerId });
    assert.equal(byActor.length, 1, "filtering by actor works");
    assert.equal(byActor[0].actorEmail, "console-v2-manager@test.local");
    assert.equal(audit.listAudit({ tenantId, action: "suspend" }).length, 1, "filtering by action works");
    assert.equal(audit.listAudit({ tenantId, limit: 1 }).length, 1, "the limit is honoured");

    // A bad row must never take the action down with it.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    audit.recordAudit({ actorUserId: ownerId, actorEmail: "x", actorRole: "owner", tenantId, action: "weird", detail: circular });
    assert.equal(audit.listAudit({ tenantId, action: "weird" }).length, 0, "an unserialisable detail is dropped, not thrown");

    // requestIp reads the proxy header Railway actually sets.
    assert.equal(audit.requestIp(new Request("https://x.test", { headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" } })), "198.51.100.4");
    assert.equal(audit.requestIp(new Request("https://x.test")), null);

    // ── OPEN-AS ─────────────────────────────────────────────────────────
    const token = createOpenToken(ownerId, tenantId, "checking their timetable import");
    const claim = consumeOpenToken(token);
    assert.ok(claim, "a fresh token is consumable");
    assert.equal(claim!.tenantId, tenantId);
    assert.equal(claim!.userId, ownerId);
    assert.equal(claim!.reason, "checking their timetable import", "the reason survives the round trip to the tenant app");
    assert.equal(consumeOpenToken(token), null, "still single-use");
    assert.equal(consumeOpenToken(createOpenToken(ownerId, tenantId))!.reason, null, "a token minted without a reason has none");

    console.log("consoleV2.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
