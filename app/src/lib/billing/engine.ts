import "server-only";

import fs from "node:fs";
import path from "node:path";

import { controlSqlite } from "@/lib/db/control";
import { closeTenantConn, openTenantDb } from "@/lib/db/tenant";
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

/**
 * Mark a tenant billing-exempt (comp — usable, never billed) or restore normal
 * billing. Exempting flips status to 'active' so it clears the payment gate
 * immediately; the daily run's `billing_exempt = 0` filters (both the renewal
 * and dunning-retry queries in `runBillingForDate`) then skip it going
 * forward. Un-exempting returns it to 'pending_payment' so it re-enters the
 * gate. Idempotent: safe to call with the same `exempt` value repeatedly.
 */
export function setBillingExempt(tenantId: number, exempt: boolean, actor: string): void {
  touch(tenantId, `billing_exempt = ?, status = ?`, exempt ? 1 : 0, exempt ? "active" : "pending_payment");
  logEvent(tenantId, exempt ? "billing_exempted" : "billing_unexempted", null, actor);
}

/**
 * Fully remove a tenant's account (DESTRUCTIVE): archive first, then delete
 * every control-plane row for this tenant + its live DB, so it's gone from
 * the system and the slug is free to re-provision. Order matters — a failure
 * must never leave un-archived data deleted:
 *
 *   1. Load the tenant + gather its manifest content (members, invoices).
 *   2. Archive: WAL-checkpoint the live tenant DB (TRUNCATE) so any row
 *      committed but still sitting only in its -wal file (tenant DBs run in
 *      WAL mode — see db/tenant.ts) is folded into the main .db FIRST, then
 *      copy that now-consistent .db (if present) + write manifest.json,
 *      under a per-call unique archive dir (slug + date + a call-time
 *      timestamp, so a same-day re-provision + re-offboard of a reused slug
 *      can never overwrite an earlier archive). If ANYTHING here throws —
 *      including an incomplete checkpoint — we throw before step 3 ever
 *      runs: nothing has been deleted yet.
 *   3. Log the "offboarded" event (billing_events.tenant_id carries no FK to
 *      tenants — see control.ts — so this row is untouched by step 4 and
 *      survives as a permanent, if orphaned, audit trail).
 *   4. Delete this tenant's control-plane rows, ATOMICALLY (one
 *      controlSqlite.transaction), in FK-safe order. `users` are NEVER
 *      deleted — identities are shared across tenants; only this tenant's
 *      `memberships` rows go (an owner whose only membership was this tenant
 *      simply ends up with an identity and no memberships).
 *   5. Remove the live tenant DB: evict/close its cached connection first
 *      (an open handle can keep the file locked or recreate -wal/-shm on
 *      next access — this also closes whatever connection step 2's
 *      checkpoint opened or reused), then delete the file (+ its per-tenant
 *      dir, when it has one) — the archived copy from step 2 is untouched.
 *      Best-effort: by this point the control rows are already gone, so a
 *      filesystem error here is logged, not thrown.
 *
 * All deletes are keyed by this `tenantId` alone — never touches another
 * tenant's rows; the archive/delete path itself is additionally guarded to
 * stay inside THIS tenant's own data/tenants/<slug>/ directory (or the
 * legacy default tenant's root-level clinic.db) even if `db_file` were ever
 * corrupted or overlapped with another tenant's.
 */
export function offboardTenant(tenantId: number, actor: string): { archiveDir: string } {
  const t = controlSqlite.prepare("SELECT slug, name, db_file FROM tenants WHERE id = ?").get(tenantId) as
    | { slug: string; name: string; db_file: string } | undefined;
  if (!t) throw new Error("Tenant not found");

  // 1) Manifest content, gathered up front (before anything destructive).
  const members = controlSqlite
    .prepare(
      `SELECT u.email AS email, m.role AS role FROM memberships m
       JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ?`,
    )
    .all(tenantId) as Array<{ email: string; role: string }>;
  const invoices = listInvoices(tenantId);

  // 2) Archive FIRST. If this throws (disk full, permissions, an incomplete
  // WAL checkpoint, …) it propagates straight out of offboardTenant — steps
  // 3-5 never run, so nothing is ever deleted without a backup that
  // succeeded.
  const dataDir = path.join(process.cwd(), "data");
  const dbPath = path.join(dataDir, t.db_file);
  // db_file is registry data (set once, by provisioning, never user input at
  // request time) — but this function both READS and later DELETES whatever
  // it points at, so refuse to touch anything outside THIS tenant's own
  // directory, rather than trust that invariant implicitly. A provisioned
  // tenant's db_file must resolve under its own data/tenants/<slug>/ dir; the
  // only other legitimate shape is the legacy default tenant's data-root-level
  // clinic.db (predates per-tenant subdirectories — see db/tenant.ts's
  // getCurrentTenant() fallback). Anything else is refused. This is what
  // stops a corrupted/overlapping db_file from ever letting this function
  // archive-then-rmSync a DIFFERENT tenant's directory, even if db_file
  // values ever collided — tighter than merely checking "somewhere under
  // data/". Guards step 5's rmSync below just as much as this copy.
  const ownTenantDir = path.join(dataDir, "tenants", t.slug) + path.sep;
  const legacyRootFile = path.join(dataDir, "clinic.db");
  if (dbPath !== legacyRootFile && !dbPath.startsWith(ownTenantDir)) {
    throw new Error(
      `[billing] offboardTenant: refusing db_file outside tenant ${t.slug}'s own directory: ${t.db_file}`,
    );
  }
  // Unique per call: date-only would let a same-day re-provision + re-offboard
  // of a reused slug silently overwrite the earlier archive — defeating the
  // entire point of archiving. Computed here (call time), not hoisted.
  const archiveDir = path.join(dataDir, "archive", `${t.slug}-${dublinToday()}-${Date.now()}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    // Tenant DBs run in WAL mode (openTenantDb() in db/tenant.ts): a row
    // committed moments ago can still be sitting ONLY in the -wal file, not
    // yet folded into dbPath itself. A plain fs.copyFileSync of dbPath alone
    // would then silently produce an archive missing that row (or even a
    // whole table) — and step 5 below deletes the live .db + its -wal right
    // after, losing it for good despite a "successful" offboard. Checkpoint
    // FIRST so the copy is a complete, consistent snapshot: this archive is
    // the ONLY safety net before permanent deletion. Reuses the same
    // db_file-keyed accessor step 5's closeTenantConn(t.db_file) evicts
    // below, so this never leaves a second, untracked connection open —
    // either it reuses whatever was already cached for this tenant, or opens
    // one that step 5 still closes before the file delete.
    const { sqlite } = openTenantDb(t.db_file);
    const [{ busy }] = sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    if (busy) {
      throw new Error(
        `[billing] offboardTenant: wal_checkpoint(TRUNCATE) did not fully flush tenant ${tenantId}'s WAL before archiving — refusing to archive a possibly-incomplete copy`,
      );
    }
    fs.copyFileSync(dbPath, path.join(archiveDir, path.basename(t.db_file)));
  }
  fs.writeFileSync(
    path.join(archiveDir, "manifest.json"),
    JSON.stringify(
      { tenantId, slug: t.slug, name: t.name, offboardedAt: new Date().toISOString(), members, invoices },
      null,
      2,
    ),
  );

  // 3) Log before deleting.
  logEvent(tenantId, "offboarded", { archiveDir, memberCount: members.length }, actor);

  // 4) Delete this tenant's control-plane rows, atomically, FK-safe order.
  // Three columns reference tenants(id) WITHOUT `ON DELETE CASCADE`
  // (users.tenant_id, auth_sessions.active_tenant_id,
  // cms_library_assets.tenant_id — see control.ts) and must be nulled out
  // first, or the final `DELETE FROM tenants` throws a foreign-key-constraint
  // error the moment this tenant has ever had an active session (i.e. every
  // real tenant). Nulling — never deleting — is what keeps those rows'
  // *identities* intact: a `users` row stays a valid login with no tenant
  // bound, an `auth_sessions` row stays a valid session that just has to
  // reselect an account, a `cms_library_assets` row stays a valid shared
  // media asset (un-scoped, same as the legacy pre-tenant_id rows already
  // handled by listLibraryAssets()). Every OTHER tenant_id column in
  // control.ts (client_credentials → client_sessions, gmail_connections,
  // billing_invoices, capture_sessions, api_keys, tenant_ai_cap,
  // form_share_links) IS `ON DELETE CASCADE` and is swept automatically by
  // the final DELETE FROM tenants below — no need to enumerate them by hand.
  const run = controlSqlite.transaction(() => {
    controlSqlite.prepare("UPDATE users SET tenant_id = NULL WHERE tenant_id = ?").run(tenantId);
    controlSqlite
      .prepare("UPDATE auth_sessions SET active_tenant_id = NULL WHERE active_tenant_id = ?")
      .run(tenantId);
    controlSqlite.prepare("UPDATE cms_library_assets SET tenant_id = NULL WHERE tenant_id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM user_invites WHERE tenant_id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM site_domains WHERE tenant_id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM tenant_billing WHERE tenant_id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(tenantId);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
  });
  run();

  // 5) Remove the live tenant DB. Evict the cache BEFORE touching the
  // filesystem. Provisioned tenants live under their own data/tenants/<slug>/
  // dir — remove it recursively (sweeps any -wal/-shm siblings too). Never
  // rmdir the shared data root itself: a root-level db_file (the legacy
  // default tenant's clinic.db) must only lose its own file(s), or this
  // would take out control.db and every other tenant's directory with it —
  // a direct violation of "never touch a different tenant".
  closeTenantConn(t.db_file);
  const dbDir = path.dirname(dbPath);
  try {
    if (dbDir !== dataDir) {
      fs.rmSync(dbDir, { recursive: true, force: true });
    } else {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
  } catch (err) {
    console.error(`[billing] offboardTenant: failed to remove live DB for tenant ${tenantId}:`, err);
  }

  return { archiveDir };
}
