// Run: npm test -- src/lib/billing/engine.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import { DEV_TOKENS, devProvider } from "../payments/devProvider";
import {
  activateTenant, createBillingRow, getBilling, listInvoices, listEvents,
  runBillingForDate, saveCard, suspendTenant, reactivateTenant, markPaid,
  chargeOutstanding, setBillingExempt,
} from "./engine";

// ── scratch tenant (control row only; no tenant DB needed by the engine) ──
// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as payments/devProvider.test.ts).
(async () => {
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

    console.log("engine.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
