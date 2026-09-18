import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getMonthlyPriceCents } from "./settings";

/**
 * The money things a console does that the automatic run cannot: a price
 * negotiated with one business, a credit owed to them, and a refund.
 *
 * All three are owner-only in the API, because each either moves money the
 * wrong way or changes what a business pays every month from now on.
 */

// ─── A negotiated price ──────────────────────────────────────────────────────

/**
 * What this business pays per month, before add-ons and VAT: their own
 * negotiated price if one has been set, otherwise the platform price.
 *
 * `monthlyLines` calls this rather than `getMonthlyPriceCents` directly, so
 * an override reaches the invoice, the estimate and every total by the same
 * route -- there is no second place that computes a price.
 */
export function getEffectiveMonthlyPriceCents(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT price_override_cents FROM tenant_billing WHERE tenant_id = ?")
    .get(tenantId) as { price_override_cents: number | null } | undefined;
  const override = row?.price_override_cents;
  return typeof override === "number" && override >= 0 ? override : getMonthlyPriceCents();
}

export function getPriceOverrideCents(tenantId: number): number | null {
  const row = controlSqlite
    .prepare("SELECT price_override_cents FROM tenant_billing WHERE tenant_id = ?")
    .get(tenantId) as { price_override_cents: number | null } | undefined;
  return row?.price_override_cents ?? null;
}

export type MoneyResult = { ok: true; note: string } | { ok: false; error: string };

/**
 * Set or clear a business's own price. Clearing (null) puts them back on
 * the platform price, whatever that is at the time -- which is the point of
 * clearing rather than writing today's platform figure into their row.
 *
 * Takes effect on their NEXT invoice. An invoice already raised keeps the
 * figure it was raised at, because changing an issued invoice under a
 * client is how a billing system loses an argument.
 */
export function setPriceOverride(tenantId: number, cents: number | null, actor: string): MoneyResult {
  const exists = controlSqlite.prepare("SELECT tenant_id FROM tenant_billing WHERE tenant_id = ?").get(tenantId);
  if (!exists) return { ok: false, error: "That business has no billing row." };
  if (cents !== null && (!Number.isInteger(cents) || cents < 0 || cents > 10_000_00)) {
    return { ok: false, error: "Give a price between €0 and €10,000." };
  }

  controlSqlite
    .prepare("UPDATE tenant_billing SET price_override_cents = ?, updated_at = ? WHERE tenant_id = ?")
    .run(cents, Date.now(), tenantId);
  logMoney(tenantId, "price_override_set", { cents }, actor);

  return cents === null
    ? { ok: true, note: `Back on the platform price (currently €${(getMonthlyPriceCents() / 100).toFixed(2)}). Applies to their next invoice.` }
    : { ok: true, note: `Their price is now €${(cents / 100).toFixed(2)} a month. Applies to their next invoice.` };
}

// ─── Credits ─────────────────────────────────────────────────────────────────

export interface CreditRow {
  id: number;
  tenantId: number;
  netCents: number;
  description: string;
  reason: string | null;
  createdBy: string;
  appliedInvoiceId: number | null;
  appliedAt: number | null;
  createdAt: number;
}

export function listCredits(tenantId: number): CreditRow[] {
  return (
    controlSqlite
      .prepare("SELECT * FROM billing_credits WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 50")
      .all(tenantId) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id as number,
    tenantId: r.tenant_id as number,
    netCents: r.net_cents as number,
    description: r.description as string,
    reason: (r.reason as string | null) ?? null,
    createdBy: (r.created_by as string) ?? "",
    appliedInvoiceId: (r.applied_invoice_id as number | null) ?? null,
    appliedAt: (r.applied_at as number | null) ?? null,
    createdAt: r.created_at as number,
  }));
}

/** Credit owed but not yet taken off an invoice, in cents. */
export function outstandingCreditCents(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT coalesce(sum(net_cents), 0) AS n FROM billing_credits WHERE tenant_id = ? AND applied_at IS NULL")
    .get(tenantId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Note a credit. It comes off their next invoice as a line, rather than
 * being refunded to a card: the money has usually not moved yet, and a
 * client who is staying would rather pay less next month than wait for a
 * bank transfer.
 */
export function addCredit(
  tenantId: number,
  input: { cents: number; description: string; reason: string },
  actor: string,
): MoneyResult {
  if (!Number.isInteger(input.cents) || input.cents <= 0 || input.cents > 10_000_00) {
    return { ok: false, error: "Give an amount between €0.01 and €10,000." };
  }
  const description = input.description.trim();
  if (!description) return { ok: false, error: "Say what the credit is for." };

  controlSqlite
    .prepare(
      "INSERT INTO billing_credits (tenant_id, net_cents, description, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(tenantId, input.cents, description, input.reason.trim() || null, actor, Date.now());
  logMoney(tenantId, "credit_added", { cents: input.cents, description }, actor);
  return { ok: true, note: `€${(input.cents / 100).toFixed(2)} credit noted. It comes off their next invoice.` };
}

/** Withdraw a credit that has not been used yet. */
export function cancelCredit(creditId: number, actor: string): MoneyResult {
  const row = controlSqlite.prepare("SELECT tenant_id, applied_at, net_cents FROM billing_credits WHERE id = ?").get(creditId) as
    | { tenant_id: number; applied_at: number | null; net_cents: number }
    | undefined;
  if (!row) return { ok: false, error: "No such credit." };
  if (row.applied_at) return { ok: false, error: "That credit has already come off an invoice." };
  controlSqlite.prepare("DELETE FROM billing_credits WHERE id = ?").run(creditId);
  logMoney(row.tenant_id, "credit_cancelled", { creditId, cents: row.net_cents }, actor);
  return { ok: true, note: "Credit withdrawn." };
}

/**
 * Claim every unapplied credit for this invoice, as one negative line.
 *
 * Called by `ensureInvoice` at the moment an invoice is raised. The claim
 * is a single UPDATE that stamps the invoice id, so two runs racing for the
 * same credits cannot both take them -- the second sees zero rows changed
 * and adds no line.
 */
export function claimCreditsForInvoice(tenantId: number, invoiceId: number): number {
  const claimed = controlSqlite
    .prepare("UPDATE billing_credits SET applied_invoice_id = ?, applied_at = ? WHERE tenant_id = ? AND applied_at IS NULL")
    .run(invoiceId, Date.now(), tenantId);
  if (claimed.changes === 0) return 0;
  const row = controlSqlite
    .prepare("SELECT coalesce(sum(net_cents), 0) AS n FROM billing_credits WHERE applied_invoice_id = ?")
    .get(invoiceId) as { n: number } | undefined;
  return row?.n ?? 0;
}

// ─── Refunds ─────────────────────────────────────────────────────────────────

/**
 * Mark a paid invoice refunded.
 *
 * HONEST LIMIT: this records the decision, it does not move the money. The
 * live gateway is the dev provider (see lib/payments) and has no refund
 * call, so the transfer is made by hand until CreatePay is connected. The
 * note says so rather than implying a refund has landed, because an
 * operator who believes it has will not make the transfer.
 */
export function refundInvoice(invoiceId: number, reason: string, actor: string): MoneyResult {
  const inv = controlSqlite
    .prepare("SELECT id, tenant_id, status, gross_cents FROM billing_invoices WHERE id = ?")
    .get(invoiceId) as { id: number; tenant_id: number; status: string; gross_cents: number } | undefined;
  if (!inv) return { ok: false, error: "No such invoice." };
  if (inv.status !== "paid") return { ok: false, error: `That invoice is "${inv.status}", not paid.` };

  controlSqlite.prepare("UPDATE billing_invoices SET status = 'refunded' WHERE id = ?").run(invoiceId);
  logMoney(inv.tenant_id, "invoice_refunded", { invoiceId, grossCents: inv.gross_cents, reason }, actor);
  return {
    ok: true,
    note: `Invoice marked refunded (€${(inv.gross_cents / 100).toFixed(2)}). The money has NOT moved — make the transfer yourself until the payment gateway is connected.`,
  };
}

// ─── Statements ──────────────────────────────────────────────────────────────

/** A business's invoice history as CSV, for sending to their accountant. */
export function statementCsv(tenantId: number): string {
  const rows = controlSqlite
    .prepare(
      `SELECT period_start, period_end, net_cents, vat_cents, gross_cents, status, paid_at, gateway_ref
       FROM billing_invoices WHERE tenant_id = ? ORDER BY period_start`,
    )
    .all(tenantId) as Array<{
    period_start: string;
    period_end: string;
    net_cents: number;
    vat_cents: number;
    gross_cents: number;
    status: string;
    paid_at: number | null;
    gateway_ref: string | null;
  }>;

  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["period_start,period_end,net,vat,gross,status,paid_at,reference"];
  for (const r of rows) {
    lines.push(
      [
        r.period_start,
        r.period_end,
        (r.net_cents / 100).toFixed(2),
        (r.vat_cents / 100).toFixed(2),
        (r.gross_cents / 100).toFixed(2),
        r.status,
        r.paid_at ? new Date(r.paid_at).toISOString() : "",
        esc(r.gateway_ref ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

/** Record on the tenant's billing history. Best-effort; a money change must not fail on its note. */
function logMoney(tenantId: number, type: string, detail: unknown, actor: string): void {
  try {
    controlSqlite
      .prepare("INSERT INTO billing_events (tenant_id, type, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(tenantId, type, JSON.stringify(detail), actor, Date.now());
  } catch (err) {
    console.error(`[billing] could not log ${type} for tenant ${tenantId}:`, err);
  }
}
