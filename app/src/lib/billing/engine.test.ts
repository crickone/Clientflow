// Run: npm test -- src/lib/billing/engine.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// engine.ts's offboardTenant now imports ../db/tenant (closeTenantConn), which
// imports React's server-only `cache` at module load. Under the runner's
// `--conditions=react-server`, npm's react "react-server" entry point is a
// stub that THROWS on load (same issue + fix as db/tenant.test.ts /
// db/agentsTable.test.ts) — shim `react` with an identity `cache` BEFORE
// engine.ts (or anything else) is required, via a dynamic require (below)
// rather than a static import, since a static `import ... from "./engine"`
// would be hoisted and evaluated before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// ── scratch tenant (control row only; no tenant DB needed by the engine) ──
// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as payments/devProvider.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { DEV_TOKENS, devProvider } =
    requireLocal("../payments/devProvider") as typeof import("../payments/devProvider");
  const {
    activateTenant, createBillingRow, getBilling, listInvoices, listEvents,
    runBillingForDate, saveCard, suspendTenant, reactivateTenant, markPaid,
    chargeOutstanding, setBillingExempt,
  } = requireLocal("./engine") as typeof import("./engine");

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'billing-test'").run();
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('billing-test','Billing Test','tenants/billing-test/void.db',1) RETURNING id")
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    for (const tbl of ["billing_invoices", "billing_events", "tenant_billing", "capture_sessions"])
      controlSqlite.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // Provision → pending_payment
    createBillingRow(tid);
    assert.equal(getBilling(tid)!.status, "pending_payment");

    // Activation: card saved + first charge succeeded on Jan 31 (anchor-day 31)
    saveCard(tid, { token: DEV_TOKENS.ok, last4: "4242", expiry: "12/28" });
    activateTenant(tid, "dev_first", "2026-01-31");
    let b = getBilling(tid)!;
    assert.equal(b.status, "active");
    assert.equal(b.anchorDay, 31);
    assert.equal(b.nextRenewalAt, "2026-02-28"); // clamped
    let inv = listInvoices(tid);
    assert.equal(inv.length, 1);
    assert.equal(inv[0].status, "paid");
    assert.deepEqual([inv[0].periodStart, inv[0].periodEnd], ["2026-01-31", "2026-02-28"]);

    // Renewal on Feb 28 succeeds → anchor restored to Mar 31
    await runBillingForDate("2026-02-28", { provider: devProvider });
    b = getBilling(tid)!;
    assert.equal(b.status, "active");
    assert.equal(b.nextRenewalAt, "2026-03-31");
    assert.equal(listInvoices(tid).length, 2);

    // Idempotency: same day again → no new invoice, no double charge
    await runBillingForDate("2026-02-28", { provider: devProvider });
    assert.equal(listInvoices(tid).length, 2);

    // Card starts declining → Mar 31 due: attempt 1 fails → past_due, retry Apr 1
    saveCard(tid, { token: DEV_TOKENS.decline, last4: "4242", expiry: "12/28" });
    await runBillingForDate("2026-03-31", { provider: devProvider });
    b = getBilling(tid)!;
    assert.equal(b.status, "past_due");
    inv = listInvoices(tid);
    const due = inv[2];
    assert.equal(due.status, "failed");
    assert.equal(due.attemptCount, 1);
    assert.equal(due.nextAttemptAt, "2026-04-01");

    // Retries: +1 (Apr 1), +3 (Apr 3) fail; a non-retry day does nothing
    await runBillingForDate("2026-04-01", { provider: devProvider });
    assert.equal(listInvoices(tid)[2].nextAttemptAt, "2026-04-03");
    await runBillingForDate("2026-04-02", { provider: devProvider }); // between retries
    assert.equal(listInvoices(tid)[2].attemptCount, 2);
    await runBillingForDate("2026-04-03", { provider: devProvider });
    assert.equal(listInvoices(tid)[2].nextAttemptAt, "2026-04-07");

    // Final retry (+7) fails → suspended
    await runBillingForDate("2026-04-07", { provider: devProvider });
    assert.equal(getBilling(tid)!.status, "suspended");
    assert.equal(listInvoices(tid)[2].attemptCount, 4);

    // Owner fixes the card → admin/auto reactivation path: markPaid on the bad
    // invoice behaves exactly like a successful late charge
    saveCard(tid, { token: DEV_TOKENS.ok, last4: "1111", expiry: "12/29" });
    markPaid(listInvoices(tid)[2].id, "admin:1");
    b = getBilling(tid)!;
    assert.equal(b.status, "active");
    assert.equal(b.failedAttempts, 0);
    assert.equal(b.nextRenewalAt, "2026-04-30"); // period after Mar 31, clamped

    // Manual suspend / reactivate round-trip
    suspendTenant(tid, "admin:1");
    assert.equal(getBilling(tid)!.status, "suspended");
    reactivateTenant(tid, "admin:1");
    assert.equal(getBilling(tid)!.status, "active");

    // ── Fix 2: interactive failure is a no-op (no dunning off an admin click) ──
    // Set up a due renewal + a declining card. next_renewal_at is '2026-04-30'
    // (from the markPaid above); insert the matching pending invoice directly so
    // it exists BEFORE any system run touches it.
    controlSqlite
      .prepare(
        `INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, status, created_at)
         VALUES (?, '2026-04-30', '2026-05-31', 1000, 230, 1230, 2300, 'pending', ?)`,
      )
      .run(tid, Date.now());
    saveCard(tid, { token: DEV_TOKENS.decline, last4: "4242", expiry: "12/28" });

    // Admin "charge now" on the declining card → fails, but must NOT advance the
    // ladder, change tenant status, or email the owner.
    const priorAttempts = listInvoices(tid).find((i) => i.periodStart === "2026-04-30")!.attemptCount;
    const interactive = await chargeOutstanding(tid, "admin:1", { provider: devProvider });
    assert.equal(interactive.ok, false);
    assert.equal(getBilling(tid)!.status, "active"); // unchanged — NOT past_due
    const dueInv = listInvoices(tid).find((i) => i.periodStart === "2026-04-30")!;
    assert.equal(dueInv.attemptCount, priorAttempts); // ladder did NOT advance
    assert.ok(
      listEvents(tid).some((e) => e.type === "charge_failed" && e.actor === "admin:1"),
      "interactive charge_failed event with actor admin:1 exists",
    );

    // The automated path STILL works: a system run on the due date advances to
    // past_due (proving the gate only silences interactive callers).
    await runBillingForDate("2026-04-30", { provider: devProvider });
    assert.equal(getBilling(tid)!.status, "past_due");
    assert.equal(listInvoices(tid).find((i) => i.periodStart === "2026-04-30")!.attemptCount, 1);

    // ── Fix 1: the claim is released on failure so a retry can re-claim ──
    const claimRow = controlSqlite
      .prepare("SELECT charge_started_at FROM billing_invoices WHERE tenant_id = ? AND period_start = '2026-04-30'")
      .get(tid) as { charge_started_at: number | null };
    assert.equal(claimRow.charge_started_at, null);

    // ── Billing-exempt toggle (comp): exempt clears the gate, unexempt restores it ──
    setBillingExempt(tid, true, "admin:1");
    b = getBilling(tid)!;
    assert.equal(b.billingExempt, true);
    assert.equal(b.status, "active");
    assert.ok(
      listEvents(tid).some((e) => e.type === "billing_exempted" && e.actor === "admin:1"),
      "billing_exempted event logged with actor admin:1",
    );

    setBillingExempt(tid, false, "admin:1");
    b = getBilling(tid)!;
    assert.equal(b.billingExempt, false);
    assert.equal(b.status, "pending_payment");
    assert.ok(
      listEvents(tid).some((e) => e.type === "billing_unexempted" && e.actor === "admin:1"),
      "billing_unexempted event logged with actor admin:1",
    );

    console.log("engine.test.ts: billing lifecycle assertions passed");
  } finally {
    cleanup();
  }
})();

// ── offboardTenant: archive-then-delete (destructive account removal) ──────
// Two scratch tenants: A gets offboarded, B is the "second tenant" control
// proving the deletion never spills outside its own tenantId. A also seeds
// the three tenants(id) FK columns that DON'T have ON DELETE CASCADE
// (users.tenant_id, auth_sessions.active_tenant_id,
// cms_library_assets.tenant_id — see db/control.ts) so this test actually
// exercises the case that would otherwise throw a foreign-key-constraint
// error on any tenant that was ever logged into, plus one CASCADE-only table
// two levels deep (client_credentials → client_sessions) to prove reliance on
// SQLite's own cascade (rather than enumerating every table by hand) holds up
// empirically, not just by reading the schema.
(() => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { openTenantDb } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { offboardTenant, createBillingRow } = requireLocal("./engine") as typeof import("./engine");

  const slugA = "offboard-test-a";
  const slugB = "offboard-test-b";
  const soloEmail = "solo-owner@offboard-test.example";
  const bEmail = "member-b@offboard-test.example";
  const dbFileA = `tenants/${slugA}/${slugA}.db`;

  // offboardTenant on an unknown id throws before touching anything.
  assert.throws(() => offboardTenant(999_999_999, "test:admin"), /Tenant not found/);

  // Pre-clean any leftovers from a previous crashed run. Order matters: null
  // the NO-ACTION FK column first (cms_library_assets.tenant_id) so deleting
  // a stale `tenants` row below can't itself throw a foreign-key error;
  // deleting `users` by email is always safe (a child row never blocks its
  // parent) and cascades away any of ITS leftover memberships/auth_sessions.
  for (const slug of [slugA, slugB]) {
    const stale = controlSqlite.prepare("SELECT id FROM tenants WHERE slug = ?").get(slug) as
      | { id: number } | undefined;
    if (stale) controlSqlite.prepare("UPDATE cms_library_assets SET tenant_id = NULL WHERE tenant_id = ?").run(stale.id);
  }
  controlSqlite.prepare("DELETE FROM users WHERE email IN (?, ?)").run(soloEmail, bEmail);
  controlSqlite.prepare("DELETE FROM tenants WHERE slug IN (?, ?)").run(slugA, slugB);
  fs.rmSync(path.join(process.cwd(), "data", "tenants", slugA), { recursive: true, force: true });

  const tenantA = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slugA, "Offboard Test A", dbFileA) as { id: number };
  const tenantAId = tenantA.id;
  const tenantB = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slugB, "Offboard Test B", `tenants/${slugB}/${slugB}.db`) as { id: number };
  const tenantBId = tenantB.id;

  // A real scratch tenant DB (mirrors db/tenant.test.ts) — both to prove the
  // live file is genuinely removed, and to capture a real better-sqlite3
  // handle so we can prove connCache eviction closed it.
  const conn = openTenantDb(dbFileA);
  const sqliteHandle = conn.sqlite;

  // userSolo: member of tenant A ONLY, plus the legacy users.tenant_id bound
  // to A — proves an identity "whose only membership was this tenant simply
  // ends up with an identity and no memberships" rather than being deleted.
  const userSolo = controlSqlite
    .prepare(
      "INSERT INTO users (email, name, password_hash, role, tenant_id, is_active) VALUES (?, 'Solo Owner', 'hash', 'owner', ?, 1) RETURNING id",
    )
    .get(soloEmail, tenantAId) as { id: number };
  const userSoloId = userSolo.id;
  controlSqlite
    .prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'owner', 1)")
    .run(userSoloId, tenantAId);

  // userB: member of tenant B ONLY — the "second identity" that must be
  // completely untouched by offboarding tenant A.
  const userB = controlSqlite
    .prepare(
      "INSERT INTO users (email, name, password_hash, role, tenant_id, is_active) VALUES (?, 'Member B', 'hash', 'staff', ?, 1) RETURNING id",
    )
    .get(bEmail, tenantBId) as { id: number };
  const userBId = userB.id;
  controlSqlite
    .prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)")
    .run(userBId, tenantBId);

  // auth_sessions.active_tenant_id pointed at tenant A (e.g. userSolo's last
  // login picked it as their active workspace) — the other NO-ACTION FK.
  const sessionId = "offboard-test-session-solo";
  controlSqlite
    .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, userSoloId, tenantAId, Date.now() + 3_600_000);

  // cms_library_assets.tenant_id pointed at tenant A — the third NO-ACTION FK
  // (shared media library; scoping only, never exclusive ownership).
  const asset = controlSqlite
    .prepare(
      "INSERT INTO cms_library_assets (tenant_id, storage_key, original_name, mime_type, size_bytes) VALUES (?, 'offboard-test-key', 'test.png', 'image/png', 100) RETURNING id",
    )
    .get(tenantAId) as { id: number };
  const assetId = asset.id;

  // The brief's explicitly-named tables, for tenant A.
  createBillingRow(tenantAId);
  controlSqlite
    .prepare(
      "INSERT INTO ai_usage (tenant_id, yyyymm, agent_key, model, cost_cents) VALUES (?, '2026-08', 'sales', 'test-model', 10)",
    )
    .run(tenantAId);
  controlSqlite
    .prepare(
      "INSERT INTO user_invites (token, email, tenant_id, role, expires_at) VALUES ('offboard-test-invite', 'invitee@offboard-test.example', ?, 'staff', ?)",
    )
    .run(tenantAId, Date.now() + 3_600_000);
  controlSqlite
    .prepare("INSERT INTO site_domains (host, tenant_id, site_id, is_primary) VALUES ('offboard-test-a.example.com', ?, 1, 1)")
    .run(tenantAId);
  const invoice = controlSqlite
    .prepare(
      `INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, status, created_at)
       VALUES (?, '2026-01-01', '2026-02-01', 1000, 230, 1230, 2300, 'paid', ?) RETURNING id`,
    )
    .get(tenantAId, Date.now()) as { id: number };

  // Not in the brief's list, but ON DELETE CASCADE — proves that reliance
  // holds, including a two-level chain (client_credentials → client_sessions).
  controlSqlite
    .prepare(
      "INSERT INTO gmail_connections (tenant_id, email, refresh_token) VALUES (?, 'gmail@offboard-test.example', 'rt')",
    )
    .run(tenantAId);
  const cred = controlSqlite
    .prepare(
      "INSERT INTO client_credentials (email, password_hash, tenant_id, client_id) VALUES ('client@offboard-test.example', 'hash', ?, 1) RETURNING id",
    )
    .get(tenantAId) as { id: number };
  controlSqlite
    .prepare("INSERT INTO client_sessions (id, credential_id, tenant_id, client_id, expires_at) VALUES ('offboard-test-client-session', ?, ?, 1, ?)")
    .run(cred.id, tenantAId, Date.now() + 3_600_000);

  // Tenant B's own control rows — must survive untouched.
  createBillingRow(tenantBId);
  controlSqlite
    .prepare(
      "INSERT INTO ai_usage (tenant_id, yyyymm, agent_key, model, cost_cents) VALUES (?, '2026-08', 'sales', 'test-model', 5)",
    )
    .run(tenantBId);

  const countWhere = (table: string, col: string, val: number) =>
    (controlSqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(val) as { n: number }).n;

  const cleanup = () => {
    // offboardTenant deliberately LEAVES identities behind — clean those up,
    // plus anything left over if the test failed before offboardTenant ran.
    controlSqlite.prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
    controlSqlite.prepare("DELETE FROM cms_library_assets WHERE id = ?").run(assetId);
    controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ?").run(userSoloId);
    controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(userSoloId);
    for (const tbl of [
      "ai_usage", "user_invites", "site_domains", "tenant_billing", "memberships",
      "gmail_connections", "client_credentials", "billing_invoices", "cms_library_assets",
    ]) {
      controlSqlite.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(tenantAId);
    }
    controlSqlite.prepare("DELETE FROM client_sessions WHERE id = ?").run("offboard-test-client-session");
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tenantAId);
    // Tenant B is entirely ours to clean up.
    controlSqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(tenantBId);
    controlSqlite.prepare("DELETE FROM tenant_billing WHERE tenant_id = ?").run(tenantBId);
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tenantBId);
    controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(userBId);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tenantBId);
    try {
      sqliteHandle.close();
    } catch {
      // already closed by offboardTenant — expected on the success path
    }
    fs.rmSync(path.join(process.cwd(), "data", "tenants", slugA), { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), "data", "tenants", slugB), { recursive: true, force: true });
  };

  let result: { archiveDir: string } | undefined;
  try {
    result = offboardTenant(tenantAId, "test:admin");

    // ── return value + archive ──
    assert.ok(result.archiveDir, "return value has archiveDir");
    assert.ok(fs.existsSync(result.archiveDir), "archive dir exists");
    const manifestPath = path.join(result.archiveDir, "manifest.json");
    assert.ok(fs.existsSync(manifestPath), "manifest.json exists in the archive dir");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      tenantId: number; slug: string; name: string; offboardedAt: string;
      members: Array<{ email: string; role: string }>;
      invoices: Array<{ id: number; grossCents: number }>;
    };
    assert.equal(manifest.tenantId, tenantAId);
    assert.equal(manifest.slug, slugA);
    assert.equal(manifest.name, "Offboard Test A");
    assert.ok(manifest.offboardedAt, "manifest has offboardedAt");
    assert.ok(
      manifest.members.some((m) => m.email === soloEmail && m.role === "owner"),
      "manifest captures the member's email + role",
    );
    assert.ok(
      manifest.invoices.some((i) => i.id === invoice.id && i.grossCents === 1230),
      "manifest captures the invoice",
    );
    const archivedDbPath = path.join(result.archiveDir, path.basename(dbFileA));
    assert.ok(fs.existsSync(archivedDbPath), "archived tenant DB copy exists");

    // ── live tenant DB removed (archived copy above is untouched) ──
    assert.equal(sqliteHandle.open, false, "the cached tenant connection was closed (connCache evicted)");
    const liveDbPath = path.join(process.cwd(), "data", dbFileA);
    assert.ok(!fs.existsSync(liveDbPath), "live tenant DB file is removed");
    assert.ok(
      !fs.existsSync(path.join(process.cwd(), "data", "tenants", slugA)),
      "live per-tenant directory is removed",
    );

    // ── tenants row + this tenant's control rows are gone ──
    assert.equal(controlSqlite.prepare("SELECT 1 FROM tenants WHERE id = ?").get(tenantAId), undefined, "tenants row is gone");
    assert.equal(countWhere("memberships", "tenant_id", tenantAId), 0, "memberships gone");
    assert.equal(controlSqlite.prepare("SELECT 1 FROM tenant_billing WHERE tenant_id = ?").get(tenantAId), undefined, "tenant_billing gone");
    assert.equal(countWhere("ai_usage", "tenant_id", tenantAId), 0, "ai_usage gone");
    assert.equal(countWhere("site_domains", "tenant_id", tenantAId), 0, "site_domains gone");
    assert.equal(countWhere("user_invites", "tenant_id", tenantAId), 0, "user_invites gone");
    assert.equal(countWhere("billing_invoices", "tenant_id", tenantAId), 0, "billing_invoices gone (cascade)");
    assert.equal(countWhere("gmail_connections", "tenant_id", tenantAId), 0, "gmail_connections gone (cascade, not in the brief's explicit list)");
    assert.equal(countWhere("client_credentials", "tenant_id", tenantAId), 0, "client_credentials gone (cascade)");
    assert.equal(
      controlSqlite.prepare("SELECT 1 FROM client_sessions WHERE id = ?").get("offboard-test-client-session"),
      undefined,
      "client_sessions gone via the 2-level cascade (client_credentials -> client_sessions)",
    );

    // ── identities are NEVER deleted, only un-scoped ──
    const soloRow = controlSqlite.prepare("SELECT * FROM users WHERE id = ?").get(userSoloId) as
      | Record<string, unknown> | undefined;
    assert.ok(soloRow, "a users identity that had a membership STILL EXISTS");
    assert.equal(soloRow!.tenant_id, null, "its legacy tenant_id binding is cleared, not the row");
    assert.equal(countWhere("memberships", "user_id", userSoloId), 0, "that identity now has zero memberships");

    const sessionRow = controlSqlite.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(sessionId) as
      | Record<string, unknown> | undefined;
    assert.ok(sessionRow, "the auth_sessions row still exists (never deleted)");
    assert.equal(sessionRow!.active_tenant_id, null, "its active_tenant_id is cleared (no dangling FK)");

    const assetRow = controlSqlite.prepare("SELECT * FROM cms_library_assets WHERE id = ?").get(assetId) as
      | Record<string, unknown> | undefined;
    assert.ok(assetRow, "the shared media asset row still exists");
    assert.equal(assetRow!.tenant_id, null, "its tenant_id is cleared, not the row");

    const eventRow = controlSqlite
      .prepare("SELECT 1 FROM billing_events WHERE tenant_id = ? AND type = 'offboarded'")
      .get(tenantAId);
    assert.ok(eventRow, "the offboarded billing_events row survives (no FK to tenants)");

    // ── multi-tenant safety: tenant B + its identity are completely untouched ──
    assert.ok(controlSqlite.prepare("SELECT 1 FROM tenants WHERE id = ?").get(tenantBId), "second tenant's row is untouched");
    assert.ok(
      controlSqlite.prepare("SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?").get(tenantBId, userBId),
      "second tenant's membership is untouched",
    );
    assert.ok(controlSqlite.prepare("SELECT 1 FROM users WHERE id = ?").get(userBId), "second tenant's identity is untouched");
    assert.ok(controlSqlite.prepare("SELECT 1 FROM tenant_billing WHERE tenant_id = ?").get(tenantBId), "second tenant's billing row is untouched");
    assert.equal(countWhere("ai_usage", "tenant_id", tenantBId), 1, "second tenant's ai_usage row is untouched");

    console.log("engine.test.ts: offboardTenant assertions passed");
  } finally {
    if (result?.archiveDir) fs.rmSync(result.archiveDir, { recursive: true, force: true });
    cleanup();
  }
})();
