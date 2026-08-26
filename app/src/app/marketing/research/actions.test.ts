// Run: npm test -- src/app/marketing/research/actions.test.ts
//
// Exact Page-ID ad matching, Task 2 — linkCompetitorPageAction /
// unlinkCompetitorPageAction (./actions.ts). Covers:
//   1. requireAdmin is enforced FOR REAL (not bypassed): a signed-in STAFF
//      session calling either action rejects (throws "FORBIDDEN"), and an
//      unauthenticated call rejects too (throws "UNAUTHENTICATED") — the
//      store is left untouched either way.
//   2. an ADMIN session's linkCompetitorPageAction call succeeds, trims
//      pageId/pageName before storage, and the store reflects the link.
//   3. input validation, still as the admin: a non-positive-integer
//      competitorId and a blank/whitespace-only pageId are both rejected
//      with {ok:false, error:"invalid_*"} — without throwing and without
//      touching the existing link.
//   4. an ADMIN session's unlinkCompetitorPageAction call succeeds and the
//      store reflects the clear; its own competitorId guard is covered too.
//   5. Content-gap analysis's two actions (scanContentAction,
//      saveResearchKeywordsAction) get the SAME requireAdmin-enforced-for-
//      real treatment as step 1 — staff rejected, unauthenticated rejected.
//      Their own behaviour once past that gate is NOT re-tested here:
//      scanContentAction thinly wraps scanCompetitorContent, already
//      covered end-to-end (mocked fetch, real scratch tenant) by
//      lib/research/contentScan.test.ts; saveResearchKeywordsAction thinly
//      wraps setResearchKeywords, which — like every @/lib/settings
//      consumer in lib/research/keywords.ts — is imported DYNAMICALLY and so
//      cannot be exercised for real under this test runner's
//      `--conditions=react-server` (see keywords.ts's own doc comment) —
//      only requireAdmin's gate is safely provable here.
//
// Unlike most *.test.ts files in this repo, this one exercises the REAL
// "use server" actions end-to-end INCLUDING their real requireAdmin() gate
// (same reasoning + shim as workout/exercises/actions.test.ts: requireAdmin's
// getCurrentMembership() (@/lib/auth) always calls next/headers's cookies()
// directly — there's no runWithTenant-style bypass for it) — so this file
// shims next/headers with a fake, mutable single-cookie jar backed by REAL
// auth_sessions rows (one admin, one staff, both members of the SAME scratch
// tenant) and lets requireAdmin() authenticate for real. next/navigation is
// stubbed too (auth.ts imports `redirect` at module top level even though
// requireAdmin() itself never calls it) and next/cache's revalidatePath is
// stubbed to a no-op (the real one throws outside an actual Next request).
//
// Unlike that file's scratch tenant (a "void.db" placeholder — its actions
// only ever touch the CONTROL-plane exercise_library table), THIS scratch
// tenant gets a REAL tenant db file (tenants/<slug>/<slug>.db, mirrors
// lib/research/store.test.ts): linkCompetitorPageAction/
// unlinkCompetitorPageAction write to the tenant's own `competitors` table
// via the ambient `db` proxy (@/lib/db), which resolves its tenant from the
// SAME session cookie requireAdmin() reads (resolveCurrentTenant() in
// lib/db/tenant.ts keys off authSessions.activeTenantId via
// resolveSessionTenant(), same as getCurrentMembership()) — so one real
// session satisfies both the auth gate AND the tenant-scoped write in a
// single call; no runWithTenant needed for the actions themselves.
// runWithTenant IS still used for this test's OWN setup/assertions (seeding
// + reading back the competitor row via lib/research/store.ts directly),
// matching store.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
// Type-only — erased at compile time, so this never touches the
// Module._load shim below the way a value import of "../../../lib/research/store" would.
import type { CompetitorRow } from "../../../lib/research/store";

let cookieToken: string | undefined;
let sessionCookieName = ""; // filled in below once control.ts's real SESSION_COOKIE is known

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/headers") {
    return {
      cookies: () => ({
        get: (name: string) => (cookieToken && name === sessionCookieName ? { value: cookieToken } : undefined),
        set: () => {},
        delete: () => {},
      }),
    };
  }
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in marketing/research/actions.test.ts");
      },
    };
  }
  if (request === "next/cache") {
    return { revalidatePath: () => {} };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as store.test.ts).
(async () => {
  const { controlSqlite, SESSION_COOKIE } = requireLocal("../../../lib/db/control") as
    typeof import("../../../lib/db/control");
  sessionCookieName = SESSION_COOKIE;
  const { runWithTenant } = requireLocal("../../../lib/db/tenant") as typeof import("../../../lib/db/tenant");
  const { upsertCompetitor, listCompetitors } = requireLocal("../../../lib/research/store") as
    typeof import("../../../lib/research/store");
  const { linkCompetitorPageAction, unlinkCompetitorPageAction, scanContentAction, saveResearchKeywordsAction } =
    requireLocal("./actions") as typeof import("./actions");

  const slug = "pageid-t2-actions-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const emailAdmin = "pageid-t2-actions-test-admin@x.ie";
  const emailStaff = "pageid-t2-actions-test-staff@x.ie";

  // Clean slate — idempotent across re-runs / a previously-crashed run.
  function wipe() {
    controlSqlite
      .prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))")
      .run(emailAdmin, emailStaff);
    controlSqlite
      .prepare("DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))")
      .run(emailAdmin, emailStaff);
    controlSqlite.prepare("DELETE FROM users WHERE email IN (?, ?)").run(emailAdmin, emailStaff);
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  }
  wipe();

  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "PageID T2 Actions Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    wipe();
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  // Both users get the SAME baseline control-plane `users.role` ('staff') —
  // it's each one's per-TENANT `memberships.role` that
  // getCurrentMembership()/requireAdmin() actually authorize on (see
  // auth.ts's resolveSessionTenant), matching updateMemberEmail.test.ts's
  // dual-user setup.
  const adminUser = controlSqlite
    .prepare("INSERT INTO users (email, password_hash, role, is_active) VALUES (?, 'x', 'staff', 1) RETURNING id")
    .get(emailAdmin) as { id: number };
  controlSqlite
    .prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'admin', 1)")
    .run(adminUser.id, tid);
  const adminSession = controlSqlite
    .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?) RETURNING id")
    .get(`pageid-t2-admin-session-${Date.now()}`, adminUser.id, tid, Date.now() + 3_600_000) as { id: string };

  const staffUser = controlSqlite
    .prepare("INSERT INTO users (email, password_hash, role, is_active) VALUES (?, 'x', 'staff', 1) RETURNING id")
    .get(emailStaff) as { id: number };
  controlSqlite
    .prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)")
    .run(staffUser.id, tid);
  const staffSession = controlSqlite
    .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?) RETURNING id")
    .get(`pageid-t2-staff-session-${Date.now()}`, staffUser.id, tid, Date.now() + 3_600_000) as { id: string };

  try {
    // Seed one competitor row directly via the store, bypassing HTTP/cookie
    // context via runWithTenant — matches store.test.ts's own setup idiom.
    const competitorId = runWithTenant(tid, () =>
      upsertCompetitor({
        placeId: "places/PAGEID-T2",
        name: "Anytime Fitness Clonmel",
        address: "1 Main St, Clonmel",
        lat: 52.355,
        lng: -7.7,
        distanceKm: 1.25,
        addedBy: "manual",
      }),
    );

    const rowOf = (): CompetitorRow => {
      const row = runWithTenant(tid, () => listCompetitors().find((c) => c.id === competitorId));
      if (!row) throw new Error("test setup: seeded competitor row not found");
      return row;
    };
    assert.equal(rowOf().facebookPageId, null, "unlinked before any of this test's calls");

    // ── 1. requireAdmin is enforced for real ──────────────────────────────
    // A STAFF session (a real membership row, role='staff') is rejected.
    cookieToken = staffSession.id;
    await assert.rejects(
      () => linkCompetitorPageAction(competitorId, "111222333", "PureGym Clonmel Official"),
      /FORBIDDEN/,
      "linkCompetitorPageAction rejects a non-admin session",
    );
    assert.equal(rowOf().facebookPageId, null, "still unlinked after the rejected staff call");

    await assert.rejects(
      () => unlinkCompetitorPageAction(competitorId),
      /FORBIDDEN/,
      "unlinkCompetitorPageAction rejects a non-admin session",
    );

    // No cookie at all → a distinct rejection (UNAUTHENTICATED, not
    // FORBIDDEN) — see requireAdmin()'s own two throws.
    cookieToken = undefined;
    await assert.rejects(
      () => linkCompetitorPageAction(competitorId, "111222333", "PureGym Clonmel Official"),
      /UNAUTHENTICATED/,
      "linkCompetitorPageAction rejects an unauthenticated call",
    );
    await assert.rejects(
      () => unlinkCompetitorPageAction(competitorId),
      /UNAUTHENTICATED/,
      "unlinkCompetitorPageAction rejects an unauthenticated call",
    );

    // ── 2. admin session: a valid link call succeeds, store reflects it ───
    cookieToken = adminSession.id;
    const linkRes = await linkCompetitorPageAction(competitorId, "  111222333  ", "  PureGym Clonmel Official  ");
    assert.deepEqual(linkRes, { ok: true }, "a valid admin link call returns {ok:true}");
    let row = rowOf();
    assert.equal(row.facebookPageId, "111222333", "facebookPageId persisted, trimmed");
    assert.equal(row.facebookPageName, "PureGym Clonmel Official", "facebookPageName persisted, trimmed");

    // ── 3. input validation, still as admin ────────────────────────────────
    let res = await linkCompetitorPageAction(0, "999", "X");
    assert.deepEqual(res, { ok: false, error: "invalid_competitor" }, "competitorId 0 is rejected");
    res = await linkCompetitorPageAction(-3, "999", "X");
    assert.deepEqual(res, { ok: false, error: "invalid_competitor" }, "a negative competitorId is rejected");
    res = await linkCompetitorPageAction(1.5, "999", "X");
    assert.deepEqual(res, { ok: false, error: "invalid_competitor" }, "a non-integer competitorId is rejected");
    res = await linkCompetitorPageAction(competitorId, "   ", "X");
    assert.deepEqual(res, { ok: false, error: "invalid_page" }, "a whitespace-only pageId is rejected");
    res = await linkCompetitorPageAction(competitorId, "", "X");
    assert.deepEqual(res, { ok: false, error: "invalid_page" }, "an empty pageId is rejected");
    // None of the rejected validation calls touched the row linked in step 2.
    row = rowOf();
    assert.equal(row.facebookPageId, "111222333", "validation failures left the existing link untouched");
    assert.equal(row.facebookPageName, "PureGym Clonmel Official");

    res = await unlinkCompetitorPageAction(0);
    assert.deepEqual(res, { ok: false, error: "invalid_competitor" }, "unlinkCompetitorPageAction rejects competitorId 0 too");
    row = rowOf();
    assert.equal(row.facebookPageId, "111222333", "the rejected unlink validation call left the link untouched");

    // ── 4. admin session: a valid unlink call succeeds, store reflects it ─
    const unlinkRes = await unlinkCompetitorPageAction(competitorId);
    assert.deepEqual(unlinkRes, { ok: true }, "a valid admin unlink call returns {ok:true}");
    row = rowOf();
    assert.equal(row.facebookPageId, null, "facebookPageId cleared");
    assert.equal(row.facebookPageName, null, "facebookPageName cleared");

    // ── 5. Content-gap analysis actions — requireAdmin is enforced for real ─
    // Same technique as step 1: a staff session is FORBIDDEN, no cookie at
    // all is UNAUTHENTICATED, for BOTH new actions. This is the important
    // security property to lock in here; scanCompetitorContent's own crawl
    // behaviour (mocked fetch, real scratch tenant) is exercised thoroughly
    // in lib/research/contentScan.test.ts instead — no need to re-prove the
    // same crawl logic a second time through this thin action wrapper.
    cookieToken = staffSession.id;
    await assert.rejects(
      () => scanContentAction(),
      /FORBIDDEN/,
      "scanContentAction rejects a non-admin session",
    );
    await assert.rejects(
      () => saveResearchKeywordsAction(new FormData()),
      /FORBIDDEN/,
      "saveResearchKeywordsAction rejects a non-admin session",
    );

    cookieToken = undefined;
    await assert.rejects(
      () => scanContentAction(),
      /UNAUTHENTICATED/,
      "scanContentAction rejects an unauthenticated call",
    );
    await assert.rejects(
      () => saveResearchKeywordsAction(new FormData()),
      /UNAUTHENTICATED/,
      "saveResearchKeywordsAction rejects an unauthenticated call",
    );

    console.log("marketing/research/actions.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
