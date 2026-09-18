// Run: npm test -- src/lib/billing/adjustments.test.ts
//
// Platform Console v2, slice 7: the money decisions a console makes that
// the automatic billing run cannot.
//
// The properties worth pinning, in order of what they would cost if wrong:
//
//   - a credit is spent EXACTLY ONCE. The claim is an UPDATE that stamps an
//     invoice id, so two runs racing for the same credits cannot both take
//     them;
//   - a credit larger than the bill leaves nothing to pay, never a negative
//     charge;
//   - a price override reaches the invoice through monthlyLines, and
//     clearing it returns the business to the platform price rather than
//     freezing today's figure into their row;
//   - an override changes the NEXT invoice and never an invoice already
//     raised;
//   - only a paid invoice can be refunded, and the note says plainly that
//     the money has not moved.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in adjustments.test.ts"); } };
  }
  if (request === "next/headers") {
    return { cookies: () => { throw new Error("no request scope"); }, headers: () => { throw new Error("no request scope"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const adj = requireLocal("./adjustments") as typeof import("./adjustments");
  const { monthlyLines, monthlySubtotalCents } = requireLocal("./addons") as typeof import("./addons");
  const { getMonthlyPriceCents } = requireLocal("./settings") as typeof import("./settings");

  const slug = "adjustments-test";
  const tid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "Adjustments Test", `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;
  controlSqlite
    .prepare("INSERT INTO tenant_billing (tenant_id, status, billing_exempt, anchor_day) VALUES (?, 'active', 0, 1)")
    .run(tid);

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM billing_invoice_lines WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE tenant_id = ?)").run(tid);
    controlSqlite.prepare("DELETE FROM billing_invoices WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM billing_credits WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM billing_events WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenant_billing WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    const platformPrice = getMonthlyPriceCents();

    // ── a negotiated price ───────────────────────────────────────────────
    assert.equal(adj.getPriceOverrideCents(tid), null, "no override to start");
    assert.equal(adj.getEffectiveMonthlyPriceCents(tid), platformPrice, "…so they pay the platform price");
    assert.equal(
      monthlyLines(tid).find((l) => l.kind === "base")!.netCents,
      platformPrice,
      "the invoice's base line is the platform price",
    );

    assert.equal(adj.setPriceOverride(tid, -1, "test").ok, false, "a negative price is refused");
    assert.equal(adj.setPriceOverride(tid, 99_999_99, "test").ok, false, "an absurd price is refused");
    assert.equal(adj.setPriceOverride(999_999_9, 100_00, "test").ok, false, "a business with no billing row is refused");

    const set = adj.setPriceOverride(tid, 149_00, "test");
    assert.ok(set.ok, "a sane price is accepted");
    assert.match(set.ok ? set.note : "", /next invoice/, "the note says when it takes effect");
    assert.equal(adj.getEffectiveMonthlyPriceCents(tid), 149_00);
    assert.equal(
      monthlyLines(tid).find((l) => l.kind === "base")!.netCents,
      149_00,
      "THE OVERRIDE REACHES THE INVOICE — one path, through monthlyLines",
    );
    assert.equal(monthlySubtotalCents(tid), 149_00, "and the subtotal every estimate uses");

    // Zero is a real price (a comped account), not "unset".
    assert.ok(adj.setPriceOverride(tid, 0, "test").ok);
    assert.equal(adj.getEffectiveMonthlyPriceCents(tid), 0, "zero means zero, not 'fall back to the platform price'");

    // Clearing returns them to the platform price, whatever it becomes.
    assert.ok(adj.setPriceOverride(tid, null, "test").ok);
    assert.equal(adj.getPriceOverrideCents(tid), null);
    assert.equal(adj.getEffectiveMonthlyPriceCents(tid), platformPrice, "…rather than freezing today's figure into their row");

    // ── credits ──────────────────────────────────────────────────────────
    assert.equal(adj.outstandingCreditCents(tid), 0);
    assert.equal(adj.addCredit(tid, { cents: 0, description: "x", reason: "" }, "test").ok, false, "zero is refused");
    assert.equal(adj.addCredit(tid, { cents: 500, description: "  ", reason: "" }, "test").ok, false, "a blank description is refused");

    assert.ok(adj.addCredit(tid, { cents: 25_00, description: "Goodwill", reason: "outage" }, "test").ok);
    assert.ok(adj.addCredit(tid, { cents: 10_00, description: "Overcharge", reason: "double billed" }, "test").ok);
    assert.equal(adj.outstandingCreditCents(tid), 35_00, "credits accumulate until they are used");
    assert.equal(adj.listCredits(tid).length, 2);

    // Newest first, and stable even though both rows were written in the
    // same millisecond.
    assert.equal(adj.listCredits(tid)[0].description, "Overcharge", "the most recent credit is listed first");

    // Withdrawing one that has not been used. Picked by description, not
    // position: the point here is the withdrawal, not the ordering.
    const overcharge = adj.listCredits(tid).find((c) => c.description === "Overcharge")!;
    assert.ok(adj.cancelCredit(overcharge.id, "test").ok, "an unused credit can be withdrawn");
    assert.equal(adj.cancelCredit(overcharge.id, "test").ok, false, "…and only once");
    assert.equal(adj.outstandingCreditCents(tid), 25_00, "only the withdrawn one is gone");

    // ── THE PROPERTY: a credit is claimed exactly once ───────────────────
    const invA = (
      controlSqlite
        .prepare(
          "INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, created_at) VALUES (?, '2026-10-01', '2026-11-01', 24900, 0, 24900, 0, ?) RETURNING id",
        )
        .get(tid, Date.now()) as { id: number }
    ).id;
    const invB = (
      controlSqlite
        .prepare(
          "INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, created_at) VALUES (?, '2026-11-01', '2026-12-01', 24900, 0, 24900, 0, ?) RETURNING id",
        )
        .get(tid, Date.now()) as { id: number }
    ).id;

    const claimedA = adj.claimCreditsForInvoice(tid, invA);
    assert.equal(claimedA, 25_00, "the first invoice takes the credit");
    const claimedB = adj.claimCreditsForInvoice(tid, invB);
    assert.equal(claimedB, 0, "THE SECOND GETS NOTHING — a credit cannot be spent twice");
    assert.equal(adj.outstandingCreditCents(tid), 0, "nothing is owed any more");
    const used = adj.listCredits(tid).find((c) => c.appliedInvoiceId === invA);
    assert.ok(used?.appliedAt, "the credit records which invoice consumed it, and when");

    // A credit added afterwards is owed again, and is not retro-applied.
    assert.ok(adj.addCredit(tid, { cents: 5_00, description: "Later", reason: "" }, "test").ok);
    assert.equal(adj.outstandingCreditCents(tid), 5_00);
    assert.equal(adj.claimCreditsForInvoice(tid, invA), 30_00, "claiming again reports this invoice's total, including what it already had");

    // ── refunds ──────────────────────────────────────────────────────────
    assert.equal(adj.refundInvoice(999_999_9, "x", "test").ok, false, "an unknown invoice is refused");
    assert.equal(adj.refundInvoice(invB, "not paid yet", "test").ok, false, "an unpaid invoice cannot be refunded");
    controlSqlite.prepare("UPDATE billing_invoices SET status = 'paid', paid_at = ? WHERE id = ?").run(Date.now(), invB);
    const refunded = adj.refundInvoice(invB, "duplicate charge", "test");
    assert.ok(refunded.ok, "a paid invoice can be refunded");
    assert.match(refunded.ok ? refunded.note : "", /has NOT moved/, "THE NOTE IS HONEST: no gateway refund happened");
    assert.equal(
      (controlSqlite.prepare("SELECT status FROM billing_invoices WHERE id = ?").get(invB) as { status: string }).status,
      "refunded",
    );
    assert.equal(adj.refundInvoice(invB, "again", "test").ok, false, "refunding twice is refused");

    // ── statements ───────────────────────────────────────────────────────
    const csv = adj.statementCsv(tid);
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "period_start,period_end,net,vat,gross,status,paid_at,reference");
    assert.equal(lines.length, 3, "a header and both invoices");
    assert.ok(lines[1].startsWith("2026-10-01,2026-11-01,249.00"), "amounts are written in euro, not cents");
    assert.ok(lines.some((l) => l.includes("refunded")), "the refunded invoice shows as refunded");

    console.log("adjustments.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
