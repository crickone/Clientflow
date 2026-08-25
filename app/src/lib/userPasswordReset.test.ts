// Run: npm test -- src/lib/userPasswordReset.test.ts
//
// Exercises everything EXCEPT the actual outbound email: requestUserReset's
// "active user + active membership" branch fire-and-forgets a dynamic
// import("@/lib/email") (see userPasswordReset.ts's file header — that graph
// only resolves under Next's own bundler, not this plain-tsx runner), so this
// suite deliberately never triggers it: EMAIL_ACTIVE below gets an active
// membership only so completeUserReset's happy path has a real session to
// revoke, and requestUserReset is instead exercised against an unknown email,
// a disabled account, and an active account with NO membership — all of
// which return before that branch is reached.
//
// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as platform/auth.test.ts and
// settings/users/updateMemberEmail.test.ts).
import assert from "node:assert/strict";

import { controlSqlite } from "./db/control";
import {
  completeUserReset,
  createUserResetToken,
  purgeExpiredUserResets,
  requestUserReset,
  verifyUserResetToken,
} from "./userPasswordReset";

(async () => {
  const EMAIL_ACTIVE = "upr-test-active@x.ie";
  const EMAIL_DISABLED = "upr-test-disabled@x.ie";
  const EMAIL_NO_MEMBERSHIP = "upr-test-no-membership@x.ie";
  const EMAIL_UNKNOWN = "upr-test-does-not-exist@x.ie";
  const TENANT_SLUG = "upr-test-tenant";
  const ALL_EMAILS = [EMAIL_ACTIVE, EMAIL_DISABLED, EMAIL_NO_MEMBERSHIP];

  // Clean slate — idempotent across re-runs / a previously-crashed run.
  function wipe() {
    const placeholders = ALL_EMAILS.map(() => "?").join(",");
    controlSqlite
      .prepare(
        `DELETE FROM user_password_resets WHERE user_id IN (SELECT id FROM users WHERE email IN (${placeholders}))`,
      )
      .run(...ALL_EMAILS);
    controlSqlite
      .prepare(`DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (${placeholders}))`)
      .run(...ALL_EMAILS);
    controlSqlite
      .prepare(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email IN (${placeholders}))`)
      .run(...ALL_EMAILS);
    controlSqlite.prepare(`DELETE FROM users WHERE email IN (${placeholders})`).run(...ALL_EMAILS);
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(TENANT_SLUG);
  }
  wipe();

  const insertUser = (email: string, opts: { isActive?: boolean; mustChangePassword?: boolean } = {}): number =>
    (
      controlSqlite
        .prepare(
          "INSERT INTO users (email, password_hash, role, is_active, must_change_password) VALUES (?, 'x', 'staff', ?, ?) RETURNING id",
        )
        .get(email, opts.isActive === false ? 0 : 1, opts.mustChangePassword ? 1 : 0) as { id: number }
    ).id;

  const userActive = insertUser(EMAIL_ACTIVE, { mustChangePassword: true });
  const userDisabled = insertUser(EMAIL_DISABLED, { isActive: false });
  const userNoMembership = insertUser(EMAIL_NO_MEMBERSHIP);

  const tenant = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(TENANT_SLUG, "UPR Test Tenant", `tenants/${TENANT_SLUG}/${TENANT_SLUG}.db`) as { id: number };
  controlSqlite
    .prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)")
    .run(userActive, tenant.id);

  const rowByToken = (token: string) =>
    controlSqlite.prepare("SELECT * FROM user_password_resets WHERE token = ?").get(token) as
      | { id: number; user_id: number; used_at: number | null; expires_at: number }
      | undefined;

  const userRow = (userId: number) =>
    controlSqlite
      .prepare("SELECT password_hash, must_change_password, is_active FROM users WHERE id = ?")
      .get(userId) as { password_hash: string; must_change_password: number; is_active: number };

  const sessionCountFor = (userId: number) =>
    (controlSqlite.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?").get(userId) as {
      n: number;
    }).n;

  const tokenCountFor = (userId: number) =>
    (controlSqlite.prepare("SELECT COUNT(*) AS n FROM user_password_resets WHERE user_id = ?").get(userId) as {
      n: number;
    }).n;

  try {
    // ── createUserResetToken: mints real, unique, single-use tokens; supersedes
    //    any prior UNUSED token for the same user (hard-deletes it, not just
    //    marks it used) so a re-send invalidates old links ──
    const t1 = createUserResetToken(userActive);
    assert.equal(typeof t1, "string");
    // 32 bytes, base64url-encoded (43 chars, no padding) — "at least 40" so
    // this still holds if the byte length is ever increased.
    assert.ok(t1.length >= 40, "token has real entropy");
    const t2 = createUserResetToken(userActive);
    assert.notEqual(t1, t2, "re-minting gives a fresh token");
    assert.equal(rowByToken(t1), undefined, "the superseded token row is gone, not just marked used");
    assert.ok(rowByToken(t2), "the new token row exists");

    // ── verifyUserResetToken: unknown token / valid token ──
    assert.deepEqual(verifyUserResetToken("does-not-exist"), { status: "invalid" });
    assert.deepEqual(verifyUserResetToken(t2), { status: "valid", email: EMAIL_ACTIVE });

    // ── verifyUserResetToken: expired (inserted directly — real TTL is 2h,
    //    too slow to wait out here) ──
    const expiredToken = "upr-test-expired-token";
    controlSqlite
      .prepare("INSERT INTO user_password_resets (user_id, token, expires_at) VALUES (?, ?, ?)")
      .run(userActive, expiredToken, Date.now() - 1000);
    assert.deepEqual(verifyUserResetToken(expiredToken), { status: "expired" });

    // ── completeUserReset: rejects a short password — no state change, token
    //    left usable ──
    let res = completeUserReset(t2, "short1");
    assert.deepEqual(res, { ok: false, error: "Password must be at least 8 characters." });
    assert.equal(rowByToken(t2)!.used_at, null, "rejected (short password) attempt leaves the token unburned");

    // ── completeUserReset: rejects an expired token ──
    res = completeUserReset(expiredToken, "a-fine-password-1");
    assert.deepEqual(res, { ok: false, error: "This link has expired. Request a new one." });

    // ── completeUserReset: happy path — sets the hash, clears
    //    must_change_password, revokes every session, burns the token ──
    const beforeHash = userRow(userActive).password_hash;
    controlSqlite
      .prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run("upr-test-session-1", userActive, Date.now() + 1000 * 60 * 60);
    assert.equal(sessionCountFor(userActive), 1, "a dangling session exists before completion");

    res = completeUserReset(t2, "a-fine-password-1");
    assert.deepEqual(res, { ok: true });
    const after = userRow(userActive);
    assert.notEqual(after.password_hash, beforeHash, "password hash changed");
    assert.equal(after.must_change_password, 0, "must_change_password cleared");
    assert.equal(sessionCountFor(userActive), 0, "every session for the user was revoked");
    assert.ok(rowByToken(t2)!.used_at, "token burned");

    // ── completeUserReset: rejects a replay of an already-used token ──
    res = completeUserReset(t2, "another-fine-password");
    assert.deepEqual(res, { ok: false, error: "This link has already been used." });
    assert.equal(userRow(userActive).password_hash, after.password_hash, "no further change from a replay");

    // ── verifyUserResetToken: used ──
    assert.deepEqual(verifyUserResetToken(t2), { status: "used" });

    // ── completeUserReset: never reactivates a disabled account — refuses AND
    //    burns the token, but leaves is_active/password_hash untouched ──
    const disabledToken = createUserResetToken(userDisabled);
    res = completeUserReset(disabledToken, "a-fine-password-2");
    assert.deepEqual(res, {
      ok: false,
      error: "This account is no longer active. Please contact an admin.",
    });
    assert.ok(rowByToken(disabledToken)!.used_at, "token burned even though the reset was refused");
    const disabledRow = userRow(userDisabled);
    assert.equal(disabledRow.is_active, 0, "still disabled — a reset must not reactivate the account");
    assert.equal(disabledRow.password_hash, "x", "password left untouched");

    // ── purgeExpiredUserResets: drops only expired+unused rows ──
    purgeExpiredUserResets();
    assert.equal(rowByToken(expiredToken), undefined, "expired token purged");
    assert.ok(rowByToken(disabledToken), "a used (even if expired-by-now) token is NOT purged by this pass");

    // ── requestUserReset: enumeration-safe — every case below returns the
    //    exact same { ok: true } shape and must not throw ──

    // Unknown email.
    assert.deepEqual(await requestUserReset(EMAIL_UNKNOWN), { ok: true });

    // Disabled account — also proves email normalization (mixed case in).
    assert.deepEqual(await requestUserReset(EMAIL_DISABLED.toUpperCase()), { ok: true });
    assert.equal(
      tokenCountFor(userDisabled),
      1,
      "requestUserReset must not mint a token for a disabled account (still just the earlier disabledToken row)",
    );

    // Active account with NO active membership — nothing to brand an email
    // with, but still reports success, and (unlike the disabled case) DOES
    // mint a usable token.
    assert.deepEqual(await requestUserReset(EMAIL_NO_MEMBERSHIP), { ok: true });
    assert.equal(
      tokenCountFor(userNoMembership),
      1,
      "a token IS minted for an active user even with no active membership",
    );
    const mintedRow = controlSqlite
      .prepare("SELECT token FROM user_password_resets WHERE user_id = ?")
      .get(userNoMembership) as { token: string };
    assert.deepEqual(verifyUserResetToken(mintedRow.token), { status: "valid", email: EMAIL_NO_MEMBERSHIP });

    console.log("userPasswordReset.test.ts: all assertions passed");
  } finally {
    wipe();
  }
})();
