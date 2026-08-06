import "server-only";

import fs from "node:fs";
import path from "node:path";

import { controlSqlite } from "@/lib/db/control";
import { getPaymentProvider, type PaymentProvider, type ChargeResult } from "@/lib/payments/provider";
import { computeVat } from "./money";
import { addMonthClamped, addDays, cmpDate, dublinDayOfMonth, dublinToday } from "./dates";
import { getMonthlyPriceCents, getVatRateBp } from "./settings";
import { sendBillingEmail } from "./emails";

/** Retry offsets (days after the due date). 4 attempts total incl. the due-day one. */
const RETRY_OFFSETS = [1, 3, 7] as const;

export type BillingStatus = "pending_payment" | "active" | "past_due" | "suspended" | "cancelled";

export interface TenantBilling {
  tenantId: number; status: BillingStatus; billingExempt: boolean;
  cardToken: string | null; cardLast4: string | null; cardExpiry: string | null;
  anchorDay: number | null; nextRenewalAt: string | null; failedAttempts: number;
}
export interface InvoiceRow {
  id: number; tenantId: number; periodStart: string; periodEnd: string;
  netCents: number; vatCents: number; grossCents: number; vatRateBp: number;
  status: "pending" | "paid" | "failed" | "waived" | "refunded";
  gatewayRef: string | null; attemptCount: number; nextAttemptAt: string | null;
  paidAt: number | null; createdAt: number;
}
export interface EventRow { id: number; tenantId: number | null; type: string; detail: string | null; actor: string; createdAt: number }
export interface RunSummary { charged: number; failed: number; suspended: number }

const rowToBilling = (r: Record<string, unknown>): TenantBilling => ({
  tenantId: r.tenant_id as number,
  status: r.status as BillingStatus,
  billingExempt: Boolean(r.billing_exempt),
  cardToken: (r.card_token as string) ?? null,
  cardLast4: (r.card_last4 as string) ?? null,
  cardExpiry: (r.card_expiry as string) ?? null,
  anchorDay: (r.anchor_day as number) ?? null,
  nextRenewalAt: (r.next_renewal_at as string) ?? null,
  failedAttempts: (r.failed_attempts as number) ?? 0,
});
const rowToInvoice = (r: Record<string, unknown>): InvoiceRow => ({
  id: r.id as number, tenantId: r.tenant_id as number,
  periodStart: r.period_start as string, periodEnd: r.period_end as string,
  netCents: r.net_cents as number, vatCents: r.vat_cents as number,
  grossCents: r.gross_cents as number, vatRateBp: r.vat_rate_bp as number,
  status: r.status as InvoiceRow["status"], gatewayRef: (r.gateway_ref as string) ?? null,
  attemptCount: r.attempt_count as number, nextAttemptAt: (r.next_attempt_at as string) ?? null,
  paidAt: (r.paid_at as number) ?? null, createdAt: r.created_at as number,
});

export function getBilling(tenantId: number): TenantBilling | null {
  const r = controlSqlite.prepare("SELECT * FROM tenant_billing WHERE tenant_id = ?").get(tenantId) as
    | Record<string, unknown> | undefined;
  return r ? rowToBilling(r) : null;
}

export function createBillingRow(tenantId: number, opts?: { exempt?: boolean }): void {
  const exempt = opts?.exempt ? 1 : 0;
  controlSqlite
    .prepare(
      `INSERT INTO tenant_billing (tenant_id, status, billing_exempt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id) DO NOTHING`,
    )
    .run(tenantId, exempt ? "active" : "pending_payment", exempt, Date.now(), Date.now());
  logEvent(tenantId, exempt ? "billing_exempt_created" : "billing_row_created", null, "system");
}

export function logEvent(tenantId: number | null, type: string, detail: unknown, actor: string): void {
  controlSqlite
    .prepare("INSERT INTO billing_events (tenant_id, type, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(tenantId, type, detail == null ? null : JSON.stringify(detail), actor, Date.now());
}

export function listEvents(tenantId: number, limit = 50): EventRow[] {
  return (controlSqlite
    .prepare("SELECT * FROM billing_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ?")
    .all(tenantId, limit) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number, tenantId: (r.tenant_id as number) ?? null, type: r.type as string,
    detail: (r.detail as string) ?? null, actor: r.actor as string, createdAt: r.created_at as number,
  }));
}

export function listInvoices(tenantId: number): InvoiceRow[] {
  return (controlSqlite
    .prepare("SELECT * FROM billing_invoices WHERE tenant_id = ? ORDER BY period_start ASC")
    .all(tenantId) as Record<string, unknown>[]).map(rowToInvoice);
}

export function saveCard(tenantId: number, card: { token: string; last4: string; expiry: string }): void {
  controlSqlite
    .prepare("UPDATE tenant_billing SET card_token = ?, card_last4 = ?, card_expiry = ?, updated_at = ? WHERE tenant_id = ?")
    .run(card.token, card.last4, card.expiry, Date.now(), tenantId);
  logEvent(tenantId, "card_saved", { last4: card.last4 }, "system");
}

const touch = (tenantId: number, sets: string, ...args: unknown[]) =>
  controlSqlite.prepare(`UPDATE tenant_billing SET ${sets}, updated_at = ${Date.now()} WHERE tenant_id = ?`).run(...args, tenantId);

/** Create (idempotently) the invoice for the period starting `periodStart`. */
function ensureInvoice(tenantId: number, periodStart: string, anchorDay: number): InvoiceRow {
  const periodEnd = addMonthClamped(periodStart, anchorDay);
  const { netCents, vatCents, grossCents } = computeVat(getMonthlyPriceCents(), getVatRateBp());
  controlSqlite
    .prepare(
      `INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, period_start) DO NOTHING`,
    )
    .run(tenantId, periodStart, periodEnd, netCents, vatCents, grossCents, getVatRateBp(), Date.now());
  return rowToInvoice(
    controlSqlite
      .prepare("SELECT * FROM billing_invoices WHERE tenant_id = ? AND period_start = ?")
      .get(tenantId, periodStart) as Record<string, unknown>,
  );
}

/** Shared success path: invoice paid → active, failures cleared, renewal advanced. */
function applyPaid(inv: InvoiceRow, gatewayRef: string | null, actor: string): void {
  controlSqlite
    .prepare("UPDATE billing_invoices SET status = 'paid', gateway_ref = COALESCE(?, gateway_ref), paid_at = ?, next_attempt_at = NULL, charge_started_at = NULL WHERE id = ?")
    .run(gatewayRef, Date.now(), inv.id);
  const b = getBilling(inv.tenantId)!;
  const anchor = b.anchorDay ?? dublinDayOfMonth(inv.periodStart);
  controlSqlite
    .prepare(
      `UPDATE tenant_billing SET status = 'active', failed_attempts = 0, last_failure_at = NULL,
       suspended_at = NULL, next_renewal_at = ?, updated_at = ? WHERE tenant_id = ?`,
    )
    .run(addMonthClamped(inv.periodStart, anchor), Date.now(), inv.tenantId);
  logEvent(inv.tenantId, "charged", { invoiceId: inv.id, grossCents: inv.grossCents, gatewayRef }, actor);
  // `b` was read BEFORE the update above, so its status is the pre-payment one:
  // a suspended tenant paying up is a reactivation, everything else a receipt.
  if (actor === "system") {
    void sendBillingEmail(inv.tenantId, b.status === "suspended" ? "reactivated" : "receipt", {
      grossCents: inv.grossCents,
    });
  }
}

/**
 * Shared failure path.
 *
 * The AUTOMATED dunning progression (advance the retry ladder / suspend, flip the
 * tenant to past_due|suspended, email the owner) runs ONLY for the daily cron
 * (`actor === "system"`). An INTERACTIVE failure — admin "charge now"
 * (`admin:<id>`) or a tenant self-pay on the suspended page (`tenant:<id>`) —
 * must NOT dun the owner or change their status off a single click: it only
 * records the attempt and releases the claim so the automated schedule still
 * owns the invoice; status / attempt_count / next_attempt_at are left untouched.
 */
function applyFailed(inv: InvoiceRow, message: string, actor: string): void {
  if (actor !== "system") {
    // Release the claim (Fix 1) so the daily run can re-claim, then just log it.
    controlSqlite
      .prepare("UPDATE billing_invoices SET charge_started_at = NULL WHERE id = ?")
      .run(inv.id);
    logEvent(inv.tenantId, "charge_failed",
      { invoiceId: inv.id, attempt: inv.attemptCount, message, interactive: true }, actor);
    return;
  }

  const attempts = inv.attemptCount + 1;
  const dueDate = inv.periodStart;
  const nextOffset = RETRY_OFFSETS[attempts - 1]; // attempt 1 → offset[0]=+1 …
  const nextAttemptAt = nextOffset != null ? addDays(dueDate, nextOffset) : null;
  controlSqlite
    .prepare("UPDATE billing_invoices SET status = 'failed', attempt_count = ?, next_attempt_at = ?, charge_started_at = NULL WHERE id = ?")
    .run(attempts, nextAttemptAt, inv.id);
  controlSqlite
    .prepare("UPDATE tenant_billing SET status = ?, failed_attempts = ?, last_failure_at = ?, suspended_at = ?, updated_at = ? WHERE tenant_id = ?")
    .run(
      nextAttemptAt ? "past_due" : "suspended",
      attempts,
      Date.now(),
      nextAttemptAt ? null : Date.now(),
      Date.now(),
      inv.tenantId,
    );
  logEvent(inv.tenantId, nextAttemptAt ? "charge_failed" : "suspended",
    { invoiceId: inv.id, attempt: attempts, nextAttemptAt, message }, actor);
  void sendBillingEmail(inv.tenantId, nextAttemptAt ? "charge_failed" : "suspended", {
    grossCents: inv.grossCents,
    nextAttemptAt,
  });
}

/** Reclaim a stalled/crashed in-flight charge after 5 min. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

async function attemptCharge(inv: InvoiceRow, provider: PaymentProvider, actor: string): Promise<boolean> {
  // Atomically claim the invoice: only one of two overlapping runs (external
  // cron + in-process scheduler, or admin charge-now racing the daily run) can
  // win this UPDATE, so the same invoice is never charged twice.
  const now = Date.now();
  const claim = controlSqlite.prepare(
    "UPDATE billing_invoices SET charge_started_at = ? WHERE id = ? AND status IN ('pending','failed') AND (charge_started_at IS NULL OR charge_started_at < ?)",
  ).run(now, inv.id, now - CLAIM_TTL_MS);
  if (claim.changes !== 1) return false; // another run owns this invoice right now — skip

  const b = getBilling(inv.tenantId);
  if (!b?.cardToken) { applyFailed(inv, "No card on file", actor); return false; }
  // A THROW (e.g. a network error under Cardstream) must become a normal failure,
  // otherwise the invoice stays claimed until the TTL and dunning stalls.
  let res: ChargeResult;
  try {
    res = await provider.chargeToken({
      token: b.cardToken, amountCents: inv.grossCents, currency: "EUR", invoiceRef: `inv_${inv.id}`,
    });
  } catch (err) {
    res = { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
  }
  if (res.ok) { applyPaid(inv, res.gatewayRef, actor); return true; }
  applyFailed(inv, res.message, actor);
  return false;
}

/** First successful charge (via capture flow): activate + record the paid first period. */
export function activateTenant(tenantId: number, chargeRef: string, today = dublinToday()): void {
  const anchor = dublinDayOfMonth(today);
  touch(tenantId, `status = 'active', anchor_day = ${anchor}, activated_at = ${Date.now()}, next_renewal_at = '${addMonthClamped(today, anchor)}'`);
  const inv = ensureInvoice(tenantId, today, anchor);
  controlSqlite
    .prepare("UPDATE billing_invoices SET status = 'paid', gateway_ref = ?, paid_at = ? WHERE id = ?")
    .run(chargeRef, Date.now(), inv.id);
  logEvent(tenantId, "activated", { invoiceId: inv.id, chargeRef }, "system");
}

/**
 * The daily billing run. Idempotent: invoices are UNIQUE(tenant_id, period_start)
 * and each retry only fires when next_attempt_at == today.
 */
export async function runBillingForDate(
  today: string,
  deps?: { provider?: PaymentProvider },
): Promise<RunSummary> {
  const provider = deps?.provider ?? getPaymentProvider();
  const summary: RunSummary = { charged: 0, failed: 0, suspended: 0 };

  // 1) Renewals due: active tenants whose next_renewal_at has arrived.
  const due = controlSqlite
    .prepare(
      `SELECT tenant_id, anchor_day, next_renewal_at FROM tenant_billing
       WHERE status = 'active' AND billing_exempt = 0 AND next_renewal_at IS NOT NULL AND next_renewal_at <= ?`,
    )
    .all(today) as Array<{ tenant_id: number; anchor_day: number; next_renewal_at: string }>;
  for (const row of due) {
    const inv = ensureInvoice(row.tenant_id, row.next_renewal_at, row.anchor_day);
    if (inv.status !== "pending") continue; // already handled (idempotency)
    (await attemptCharge(inv, provider, "system")) ? summary.charged++ : summary.failed++;
  }

  // 2) Dunning retries: failed invoices whose retry date has arrived.
  const retries = controlSqlite
    .prepare(
      `SELECT bi.* FROM billing_invoices bi
       JOIN tenant_billing tb ON tb.tenant_id = bi.tenant_id
       WHERE bi.status = 'failed' AND bi.next_attempt_at IS NOT NULL AND bi.next_attempt_at <= ?
         AND tb.status = 'past_due' AND tb.billing_exempt = 0`,
    )
    .all(today) as Record<string, unknown>[];
  for (const r of retries) {
    const inv = rowToInvoice(r);
    const ok = await attemptCharge(inv, provider, "system");
    if (ok) summary.charged++;
    else if (getBilling(inv.tenantId)?.status === "suspended") summary.suspended++;
    else summary.failed++;
  }
  return summary;
}

/** Admin "charge now" / owner reactivation: charge the oldest unpaid invoice. */
export async function chargeOutstanding(
  tenantId: number,
  actor: string,
  deps?: { provider?: PaymentProvider },
): Promise<{ ok: boolean; error?: string }> {
  const provider = deps?.provider ?? getPaymentProvider();
  const r = controlSqlite
    .prepare("SELECT * FROM billing_invoices WHERE tenant_id = ? AND status IN ('pending','failed') ORDER BY period_start ASC LIMIT 1")
    .get(tenantId) as Record<string, unknown> | undefined;
  if (!r) return { ok: false, error: "No outstanding invoice" };
  const ok = await attemptCharge(rowToInvoice(r), provider, actor);
  return ok ? { ok: true } : { ok: false, error: "Charge failed" };
}

export function markPaid(invoiceId: number, actor: string): void {
  const r = controlSqlite.prepare("SELECT * FROM billing_invoices WHERE id = ?").get(invoiceId) as
    | Record<string, unknown> | undefined;
  if (!r) throw new Error("Invoice not found");
  applyPaid(rowToInvoice(r), null, actor);
  logEvent(rowToInvoice(r).tenantId, "marked_paid", { invoiceId }, actor);
}

export function waiveInvoice(invoiceId: number, actor: string): void {
  const r = controlSqlite.prepare("SELECT * FROM billing_invoices WHERE id = ?").get(invoiceId) as
    | Record<string, unknown> | undefined;
  if (!r) throw new Error("Invoice not found");
  const inv = rowToInvoice(r);
  // Waive = forgive the period entirely; same forward motion as a payment.
  applyPaid(inv, null, actor);
  controlSqlite.prepare("UPDATE billing_invoices SET status = 'waived', paid_at = NULL WHERE id = ?").run(invoiceId);
  logEvent(inv.tenantId, "waived", { invoiceId }, actor);
}

export function compMonths(tenantId: number, months: number, actor: string): void {
  const b = getBilling(tenantId);
  if (!b?.nextRenewalAt || !b.anchorDay) throw new Error("Tenant has no active billing cycle");
  let d = b.nextRenewalAt;
  for (let i = 0; i < months; i++) d = addMonthClamped(d, b.anchorDay);
  touch(tenantId, `next_renewal_at = '${d}'`);
  logEvent(tenantId, "comped", { months, newRenewal: d }, actor);
}

export function suspendTenant(tenantId: number, actor: string): void {
  touch(tenantId, `status = 'suspended', suspended_at = ${Date.now()}`);
  logEvent(tenantId, "suspended", { manual: true }, actor);
}

export function reactivateTenant(tenantId: number, actor: string): void {
  touch(tenantId, `status = 'active', failed_attempts = 0, suspended_at = NULL`);
  logEvent(tenantId, "reactivated", { manual: true }, actor);
  void sendBillingEmail(tenantId, "reactivated", {});
}

/** Cancel + archive: copy the tenant DB into data/archive/, deactivate the tenant. */
export function offboardTenant(tenantId: number, actor: string): { archiveDir: string } {
  const t = controlSqlite.prepare("SELECT slug, db_file FROM tenants WHERE id = ?").get(tenantId) as
    | { slug: string; db_file: string } | undefined;
  if (!t) throw new Error("Tenant not found");
  const dataDir = path.join(process.cwd(), "data");
  const archiveDir = path.join(dataDir, "archive", `${t.slug}-${dublinToday()}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  const src = path.join(dataDir, t.db_file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(archiveDir, path.basename(t.db_file)));
  fs.writeFileSync(
    path.join(archiveDir, "manifest.json"),
    JSON.stringify({ tenantId, slug: t.slug, offboardedAt: new Date().toISOString(), invoices: listInvoices(tenantId) }, null, 2),
  );
  touch(tenantId, `status = 'cancelled'`);
  controlSqlite.prepare("UPDATE tenants SET is_active = 0 WHERE id = ?").run(tenantId);
  logEvent(tenantId, "offboarded", { archiveDir }, actor);
  return { archiveDir };
}
