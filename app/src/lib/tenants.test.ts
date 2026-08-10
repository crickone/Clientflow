// Run: npm test -- src/lib/tenants.test.ts
//
// Provisioning v2: the multi-admin create-or-grant seam (provisionTenantAdmins)
// behind POST /api/platform/tenants. Given a mix of brand-new and existing
// admin emails: new ones get a fresh identity + generated temp password +
// must_change_password + an admin membership; existing ones get an admin
// membership ONLY — their password/must-change flag is never touched. The
// FIRST entry in the list is always the owner, regardless of new/existing.
// Also covers "add me" (grantAdminMembership, reused from the "Open business"
// feature) being idempotent for the platform admin's own identity.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// tenants.ts imports lib/db/tenant.ts (openTenantDb) and lib/auth.ts, both of
// which import React's server-only `cache` at module load. Under the runner's
// `--conditions=react-server`, npm's react "react-server" entry point is a
// stub that THROWS on load (same issue + fix as db/tenant.test.ts /
// billing/engine.test.ts) — shim `react` with an identity `cache` BEFORE
// tenants.ts (or anything else) is required, via a dynamic require (below)
// rather than a static import, since a static `import ... from "./tenants"`
// would be hoisted and evaluated before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
const { verifyPassword } = requireLocal("./password") as typeof import("./password");
const { grantAdminMembership } = requireLocal("./platform/access") as typeof import("./platform/access");
const { createTenant, provisionTenantAdmins } = requireLocal("./tenants") as typeof import("./tenants");

const SLUG = "provision-v2-test";
const OWNER_EMAIL = "provision-v2-owner@x.ie";
const EXISTING_EMAIL = "provision-v2-existing@x.ie";
const NEW_ADMIN_EMAIL = "provision-v2-new-admin@x.ie";
const PLATFORM_ADMIN_EMAIL = "provision-v2-platform-admin@x.ie";
const EXISTING_HASH_MARKER = "untouched-existing-hash";
const SCRATCH_EMAILS = [OWNER_EMAIL, EXISTING_EMAIL, NEW_ADMIN_EMAIL, PLATFORM_ADMIN_EMAIL];

function cleanup() {
  const t = controlSqlite.prepare("SELECT id FROM tenants WHERE slug = ?").get(SLUG) as
    | { id: number }
    | undefined;
  if (t) {
    for (const tbl of ["memberships", "billing_invoices", "billing_events", "tenant_billing", "capture_sessions"]) {
      controlSqlite.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(t.id);
    }
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  }
  controlSqlite
    .prepare(`DELETE FROM users WHERE email IN (${SCRATCH_EMAILS.map(() => "?").join(",")})`)
    .run(...SCRATCH_EMAILS);
  try {
    fs.rmSync(path.join(process.cwd(), "data", "tenants", SLUG), { recursive: true, force: true });
  } catch {
    // best effort
  }
}

cleanup(); // in case a previous run crashed mid-test

// Pre-seed the "existing" admin identity — provisionTenantAdmins must reuse it
// untouched (no password reset, no forced must-change).
controlSqlite
  .prepare("INSERT INTO users (email, password_hash, must_change_password) VALUES (?, ?, 0)")
  .run(EXISTING_EMAIL, EXISTING_HASH_MARKER);

// A separate identity standing in for the logged-in PLATFORM admin (g.userId)
// requesting "add me" — already has its own login, unrelated to this tenant.
const platformAdmin = controlSqlite
  .prepare("INSERT INTO users (email, password_hash) VALUES (?, 'x') RETURNING id")
  .get(PLATFORM_ADMIN_EMAIL) as { id: number };

try {
  const tenant = createTenant({ slug: SLUG, name: "Provision V2 Test", venueType: "clinic" });

  // Mix of brand-new (owner + a second new admin) and one existing email, in
  // order — the FIRST entry must end up flagged owner regardless of its
  // new/existing status.
  const results = provisionTenantAdmins(tenant.id, [
    { email: OWNER_EMAIL, name: "Owner Name" },
    { email: EXISTING_EMAIL, name: "Should be ignored for an existing identity" },
    { email: NEW_ADMIN_EMAIL },
  ]);

  assert.equal(results.length, 3, "one result per admin entry");

  // ── First entry: brand-new identity, flagged owner ───────────────────────
  assert.equal(results[0].email, OWNER_EMAIL);
  assert.equal(results[0].owner, true, "the first admin is the owner");
  assert.equal(results[0].existing, false, "a brand-new email is not 'existing'");
  assert.ok(
    results[0].tempPassword && results[0].tempPassword.length >= 8,
    "a brand-new identity gets a temp password",
  );

  // ── Second entry: pre-existing identity — NOT owner, no password reset ──
  assert.equal(results[1].email, EXISTING_EMAIL);
  assert.equal(results[1].owner, false, "only the first admin is the owner");
  assert.equal(results[1].existing, true, "a pre-existing email is flagged existing");
  assert.equal(results[1].tempPassword, undefined, "an existing identity gets NO temp password");

  // ── Third entry: another brand-new identity — NOT owner ──────────────────
  assert.equal(results[2].email, NEW_ADMIN_EMAIL);
  assert.equal(results[2].owner, false);
  assert.equal(results[2].existing, false);
  assert.ok(results[2].tempPassword, "a second new identity also gets its own temp password");

  // ── DB-level proof: the two new identities are real, usable, must-change ─
  for (const r of [results[0], results[2]]) {
    const row = controlSqlite
      .prepare("SELECT password_hash, must_change_password FROM users WHERE email = ?")
      .get(r.email) as { password_hash: string; must_change_password: number };
    assert.ok(
      verifyPassword(r.tempPassword!, row.password_hash),
      `${r.email}'s stored hash verifies against the returned temp password`,
    );
    assert.equal(row.must_change_password, 1, `${r.email} is forced to change password on first sign-in`);
  }

  // ── DB-level proof: the EXISTING identity's password/flag are UNTOUCHED ──
  const existingRow = controlSqlite
    .prepare("SELECT password_hash, must_change_password FROM users WHERE email = ?")
    .get(EXISTING_EMAIL) as { password_hash: string; must_change_password: number };
  assert.equal(
    existingRow.password_hash,
    EXISTING_HASH_MARKER,
    "an existing identity's password hash is never touched",
  );
  assert.equal(existingRow.must_change_password, 0, "an existing identity's must-change flag is never forced");

  // ── All three end up ADMIN members of the new tenant ─────────────────────
  for (const r of results) {
    const u = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").get(r.email) as { id: number };
    const m = controlSqlite
      .prepare("SELECT role, is_active FROM memberships WHERE user_id = ? AND tenant_id = ?")
      .get(u.id, tenant.id) as { role: string; is_active: number } | undefined;
    assert.deepEqual(m, { role: "admin", is_active: 1 }, `${r.email} has an active admin membership`);
  }

  // ── "Add me": the platform admin's own grant (grantAdminMembership, reused
  // from Open business) — idempotent, a second call changes nothing. ───────
  const grant1 = grantAdminMembership(tenant.id, platformAdmin.id);
  assert.equal(grant1.granted, true, "addMe grants the platform admin a fresh admin membership");
  const platformMembership = () =>
    controlSqlite
      .prepare("SELECT role, is_active FROM memberships WHERE user_id = ? AND tenant_id = ?")
      .get(platformAdmin.id, tenant.id) as { role: string; is_active: number } | undefined;
  assert.deepEqual(platformMembership(), { role: "admin", is_active: 1 });

  const grant2 = grantAdminMembership(tenant.id, platformAdmin.id);
  assert.equal(grant2.granted, false, "addMe is idempotent — calling it again grants nothing new");
  assert.deepEqual(platformMembership(), { role: "admin", is_active: 1 }, "still exactly one admin membership");

  console.log("lib/tenants.test.ts: all assertions passed");
} finally {
  cleanup();
}
