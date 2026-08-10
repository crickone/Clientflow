// Run: npm test -- src/app/settings/users/updateMemberEmail.test.ts
//
// Tests the decision logic of updateMemberEmailAction (guards 2–6: tenant-
// scope, validate/normalize, no-op, uniqueness, update) via the pure helper
// it's built on, applyMemberEmailUpdate — exported from actions.ts
// specifically so this is testable without a request-scoped session/cookie.
// Guard 1 (requireAdmin, resolving the active tenant) lives in the "use
// server" wrapper and isn't re-tested here: it's the same adminContext()
// helper every other action in this file already relies on.
//
// actions.ts -> @/lib/auth (react `cache`, next/headers, next/navigation
// `redirect`) and -> @/lib/invites -> @/lib/db/tenant (react `cache`,
// next/headers) -> ..., and actions.ts itself -> next/cache (revalidatePath,
// which also pulls in react's package.json "react-server" entry internally).
// Under the runner's `--conditions=react-server`, that entry point throws on
// load — same issue + fix as tenant.test.ts / tools.marketing.test.ts: shim
// `request === "react"` (verified this also covers next/cache's internal
// react import) and stub next/navigation's `redirect` (never actually called
// in this test's code path — applyMemberEmailUpdate doesn't call
// requireAdminPage). Installed via a dynamic require (below) rather than a
// static import, since a static `import ... from "./actions"` would be
// hoisted and evaluated before this shim runs.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error(
          "next/navigation.redirect() stub called unexpectedly in updateMemberEmail.test.ts",
        );
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as platform/auth.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../../../lib/db/control") as
    typeof import("../../../lib/db/control");
  const { applyMemberEmailUpdate } = requireLocal("./actions") as
    typeof import("./actions");

  const slug = "clf-test-member-email-tenant";
  const emailA = "clf-test-member-email-a@x.ie"; // member of the tenant — the one we edit
  const emailB = "clf-test-member-email-b@x.ie"; // member of the tenant — the "taken" email
  const emailStranger = "clf-test-member-email-stranger@x.ie"; // exists, NOT a member of the tenant
  const emailNew = "clf-test-member-email-new@x.ie"; // A's target new email
  const allEmails = [emailA, emailB, emailStranger, emailNew];

  // Clean slate — idempotent across re-runs / a previously-crashed run.
  function wipe() {
    controlSqlite
      .prepare(
        `DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email IN (${allEmails.map(() => "?").join(",")}))`,
      )
      .run(...allEmails);
    controlSqlite
      .prepare(`DELETE FROM users WHERE email IN (${allEmails.map(() => "?").join(",")})`)
      .run(...allEmails);
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  }
  wipe();

  const tenant = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Member Email Test Tenant", `tenants/${slug}/${slug}.db`) as { id: number };
  const tenantId = tenant.id;

  const insertUser = (email: string): number =>
    (
      controlSqlite
        .prepare(
          "INSERT INTO users (email, password_hash, role, is_active) VALUES (?, 'x', 'staff', 1) RETURNING id",
        )
        .get(email) as { id: number }
    ).id;

  const userA = insertUser(emailA);
  const userB = insertUser(emailB);
  const userStranger = insertUser(emailStranger);

  controlSqlite
    .prepare(
      "INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)",
    )
    .run(userA, tenantId);
  controlSqlite
    .prepare(
      "INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'admin', 1)",
    )
    .run(userB, tenantId);
  // userStranger deliberately gets no membership row in this tenant.

  const emailOf = (userId: number): string =>
    (
      controlSqlite.prepare("SELECT email FROM users WHERE id = ?").get(userId) as {
        email: string;
      }
    ).email;

  try {
    // ── invalid email: rejected, no change ──
    let res = await applyMemberEmailUpdate(tenantId, userA, "not-an-email");
    assert.deepEqual(res, { ok: false, error: "Invalid email" });
    assert.equal(emailOf(userA), emailA, "unchanged after an invalid-email attempt");

    // ── target userId NOT a member of the acting tenant: rejected, no change ──
    // userStranger exists as an identity but has no membership row in
    // `tenantId` — proves an admin can't reach an arbitrary identity through
    // this action, only someone actually in their account.
    res = await applyMemberEmailUpdate(tenantId, userStranger, emailNew);
    assert.deepEqual(res, { ok: false, error: "Not a member of this account" });
    assert.equal(emailOf(userStranger), emailStranger, "stranger's email untouched");

    // ── email already used by another user: rejected, no change ──
    // A differently-cased form of B's email still collides — proves
    // normalization (lowercase) happens BEFORE the uniqueness check.
    res = await applyMemberEmailUpdate(tenantId, userA, emailB.toUpperCase());
    assert.deepEqual(res, {
      ok: false,
      error: "That email is already in use by another account",
    });
    assert.equal(emailOf(userA), emailA, "unchanged after a duplicate-email attempt");

    // ── unchanged email: ok, no-op ──
    // A differently-cased form of A's OWN current email still counts as
    // "unchanged" (normalize-before-compare) — and must NOT be rejected as a
    // duplicate against itself.
    res = await applyMemberEmailUpdate(tenantId, userA, emailA.toUpperCase());
    assert.deepEqual(res, { ok: true });
    assert.equal(emailOf(userA), emailA, "no-op: still the original email");

    // ── valid new email for a member of the tenant: updates users.email ──
    res = await applyMemberEmailUpdate(tenantId, userA, emailNew.toUpperCase());
    assert.deepEqual(res, { ok: true });
    assert.equal(emailOf(userA), emailNew, "persisted normalized (lowercased)");

    // B and the stranger were never touched by any of the above.
    assert.equal(emailOf(userB), emailB);
    assert.equal(emailOf(userStranger), emailStranger);

    console.log("settings/users/updateMemberEmail.test.ts: all assertions passed");
  } finally {
    wipe();
  }
})();
