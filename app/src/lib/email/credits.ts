import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/**
 * Prepaid email-credit ledger + pricing (control plane) — the money
 * foundation for the GHL-style email marketing add-on. Tenants prepay in
 * cents; every send is metered against their balance at a per-1000-recipient
 * price set with a margin over the underlying provider cost (Mailgun).
 *
 * Mirrors lib/ai/usage.ts's shape: an `assertXAvailable` (throws) / `recordX`
 * bracket around the metered action, plus a sparse per-tenant override table
 * (here: email_credits) read as `row?.value ?? DEFAULT`. The GLOBAL price
 * lives in `platform_settings` via lib/billing/settings.ts, same as the
 * platform's own monthly_price_cents/vat_rate_bp.
 *
 * This module is ledger + pricing ONLY — no contacts, campaigns, sending, or
 * UI, and critically no payment/card code: balances only move via explicit
 * `grantCredits` calls (admin allocation UI + auto-topup EXECUTION are later
 * tasks; `getAutoTopup`/`setAutoTopup` here just persist the config).
 *
 * Money-safety invariant: every balance mutation (grant or spend) is a single
 * `controlSqlite.transaction()` — read balance, compute the new balance,
 * guard against going negative, write balance + insert exactly one ledger row
 * carrying that same `balance_after_cents`, all inside one SQLite transaction.
 * SQLite serializes writers (busy_timeout=15000, see ./control.ts), so two
 * concurrent sends can't interleave their read-compute-write and corrupt the
 * balance or record a wrong `balance_after_cents`; a throw anywhere inside the
 * transaction rolls back everything it did (no partial write).
 */

/** platform_settings key for the global (not per-tenant) email credit price. */
export const EMAIL_PRICE_KEY = "email_credit_price_cents";

/** €2.00 / 1000 recipients — roughly 5x Mailgun's underlying per-send cost. */
export const DEFAULT_EMAIL_PRICE_PER_1000_CENTS = 200;

/** Bounds enforced by `setEmailPricePer1000Cents` itself (see MIN/MAX_CAP_CENTS
 *  in lib/ai/usage.ts for the same reasoning): every caller is protected, not
 *  just whichever admin UI ends up calling it. */
const MIN_EMAIL_PRICE_PER_1000_CENTS = 0;
const MAX_EMAIL_PRICE_PER_1000_CENTS = 10_000; // €100 / 1000 — sanity ceiling

/** Sanity ceiling for auto-topup threshold/amount (cents) — generous enough
 *  to never constrain real usage, tight enough to catch a typo'd extra zero. */
const MAX_AUTO_TOPUP_CENTS = 1_000_000; // €10,000

/** Reads the global per-1000-recipient email price (cents), falling back to
 *  `DEFAULT_EMAIL_PRICE_PER_1000_CENTS` when never customized. */
export function getEmailPricePer1000Cents(): number {
  const raw = getPlatformSetting(EMAIL_PRICE_KEY);
  if (raw == null) return DEFAULT_EMAIL_PRICE_PER_1000_CENTS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_EMAIL_PRICE_PER_1000_CENTS;
}

/** Admin-only setter — bounds-checked here (not in the caller) so every
 *  caller gets the same guarantee, the same reasoning as setTenantCapCents. */
export function setEmailPricePer1000Cents(cents: number): void {
  if (
    !Number.isInteger(cents) ||
    cents < MIN_EMAIL_PRICE_PER_1000_CENTS ||
    cents > MAX_EMAIL_PRICE_PER_1000_CENTS
  ) {
    throw new Error(
      `Email credit price must be a whole number of cents between ${MIN_EMAIL_PRICE_PER_1000_CENTS} and ${MAX_EMAIL_PRICE_PER_1000_CENTS}.`,
    );
  }
  setPlatformSetting(EMAIL_PRICE_KEY, String(cents));
}

/** Cost (cents) to send to `n` recipients at the current global price,
 *  rounded UP to the nearest cent so the platform never under-charges. */
export function costForRecipients(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("Recipient count must be a non-negative whole number.");
  }
  return Math.ceil((n * getEmailPricePer1000Cents()) / 1000);
}

/** Thrown when a tenant's email-credit balance can't cover a requested spend. */
export class EmailCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailCreditsError";
  }
}

/** A tenant's current email-credit balance (cents). Sparse row: a tenant that
 *  has never been granted credits has no row and reads as 0. */
export function getEmailBalanceCents(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT balance_cents FROM email_credits WHERE tenant_id = ?")
    .get(tenantId) as { balance_cents: number } | undefined;
  return row?.balance_cents ?? 0;
}

export interface AutoTopupConfig {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
}

/** A tenant's auto-topup config. Sparse row: defaults to disabled/0/0 when
 *  never configured. NOTE: this task only persists the config — the "balance
 *  fell below threshold → charge the card for amount" execution is a later
 *  task (no payment code exists here). */
export function getAutoTopup(tenantId: number): AutoTopupConfig {
  const row = controlSqlite
    .prepare(
      "SELECT auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents FROM email_credits WHERE tenant_id = ?",
    )
    .get(tenantId) as
    | {
        auto_topup_enabled: number;
        auto_topup_threshold_cents: number;
        auto_topup_amount_cents: number;
      }
    | undefined;
  return {
    enabled: !!row?.auto_topup_enabled,
    thresholdCents: row?.auto_topup_threshold_cents ?? 0,
    amountCents: row?.auto_topup_amount_cents ?? 0,
  };
}

/** Bounds-checked here (not the caller) — same reasoning as
 *  `setEmailPricePer1000Cents`. Upserts WITHOUT touching balance_cents: a
 *  fresh row picks up its table DEFAULT (0), an existing row's balance is
 *  left untouched by the `ON CONFLICT` clause below (config-only write, so it
 *  doesn't need the balance-mutation transaction treatment). */
export function setAutoTopup(tenantId: number, cfg: AutoTopupConfig): void {
  const { enabled, thresholdCents, amountCents } = cfg;
  if (
    !Number.isInteger(thresholdCents) ||
    thresholdCents < 0 ||
    thresholdCents > MAX_AUTO_TOPUP_CENTS
  ) {
    throw new Error(
      `Auto-topup threshold must be a whole number of cents between 0 and ${MAX_AUTO_TOPUP_CENTS}.`,
    );
  }
  if (
    !Number.isInteger(amountCents) ||
    amountCents < 0 ||
    amountCents > MAX_AUTO_TOPUP_CENTS
  ) {
    throw new Error(
      `Auto-topup amount must be a whole number of cents between 0 and ${MAX_AUTO_TOPUP_CENTS}.`,
    );
  }
  if (enabled && amountCents <= 0) {
    throw new Error("Auto-topup amount must be greater than 0 when enabled.");
  }
  controlSqlite
    .prepare(
      `INSERT INTO email_credits (tenant_id, auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents, updated_at)
       VALUES (?, ?, ?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET
         auto_topup_enabled = excluded.auto_topup_enabled,
         auto_topup_threshold_cents = excluded.auto_topup_threshold_cents,
         auto_topup_amount_cents = excluded.auto_topup_amount_cents,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, enabled ? 1 : 0, thresholdCents, amountCents);
}

/**
 * True if a platform admin has suspended this tenant's marketing (abuse/
 * compliance kill switch — independent of balance/auto-topup). Sparse row: a
 * tenant that's never been suspended has no row and reads as false. Checked
 * by `precheckCampaign` (@/lib/marketing/send.ts), which fails closed.
 */
export function isMarketingSuspended(tenantId: number): boolean {
  const row = controlSqlite
    .prepare("SELECT marketing_suspended FROM email_credits WHERE tenant_id = ?")
    .get(tenantId) as { marketing_suspended: number } | undefined;
  return !!row?.marketing_suspended;
}

/**
 * Admin-only setter — upserts WITHOUT touching balance_cents, same shape as
 * `setAutoTopup` (config-only write, no ledger row, so it doesn't need the
 * balance-mutation transaction treatment). `actor` is accepted (not stored —
 * this table has no ledger/note column to carry it, unlike
 * grantCredits/recordCreditSpend) purely so the call site reads as an
 * audited admin action; the actual audit trail is the CALLER's job — the
 * platform route logs it via `logEvent` (billing_events), same division of
 * responsibility as `grant-credits`.
 */
export function setMarketingSuspended(tenantId: number, suspended: boolean, actor: string): void {
  void actor;
  controlSqlite
    .prepare(
      `INSERT INTO email_credits (tenant_id, marketing_suspended, updated_at)
       VALUES (?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET
         marketing_suspended = excluded.marketing_suspended,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, suspended ? 1 : 0);
}

export interface LedgerRow {
  id: number;
  tenantId: number;
  deltaCents: number;
  reason: "topup" | "send" | "adjustment" | "refund" | "auto_topup" | string;
  campaignId: number | null;
  balanceAfterCents: number;
  note: string | null;
  createdAt: number;
}

type LedgerReason = "topup" | "send" | "adjustment" | "refund" | "auto_topup";

/**
 * The ONE place balance_cents is ever written. Reads the current balance,
 * computes the new one, guards against going negative, then writes the new
 * balance + inserts exactly one ledger row carrying it — all inside a single
 * `controlSqlite.transaction()` so the pair can never drift apart, and a
 * thrown guard leaves NO trace (SQLite rolls back everything the wrapped
 * function did). `note` carries `actor`: the ledger schema has no dedicated
 * actor column, and every caller here has exactly one free-text slot to fill.
 */
function mutateBalance(
  tenantId: number,
  deltaCents: number,
  reason: LedgerReason,
  opts: { campaignId?: number | null; note?: string | null } = {},
): number {
  const run = controlSqlite.transaction(() => {
    const row = controlSqlite
      .prepare("SELECT balance_cents FROM email_credits WHERE tenant_id = ?")
      .get(tenantId) as { balance_cents: number } | undefined;
    const currentBalance = row?.balance_cents ?? 0;
    const newBalance = currentBalance + deltaCents;
    if (newBalance < 0) {
      throw new EmailCreditsError(
        `Insufficient email credits: balance is ${currentBalance}c, this spend would take it to ${newBalance}c.`,
      );
    }
    controlSqlite
      .prepare(
        `INSERT INTO email_credits (tenant_id, balance_cents, updated_at)
         VALUES (?, ?, unixepoch() * 1000)
         ON CONFLICT(tenant_id) DO UPDATE SET
           balance_cents = excluded.balance_cents,
           updated_at = excluded.updated_at`,
      )
      .run(tenantId, newBalance);
    controlSqlite
      .prepare(
        `INSERT INTO email_credit_ledger (tenant_id, delta_cents, reason, campaign_id, balance_after_cents, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(tenantId, deltaCents, reason, opts.campaignId ?? null, newBalance, opts.note ?? null);
    return newBalance;
  });
  return run();
}

/** Throws `EmailCreditsError` when `tenantId`'s balance is below `cents`
 *  (balance == cents passes — the boundary is inclusive). Call BEFORE doing
 *  the metered work; `recordCreditSpend` guards again at write time so a
 *  caller that skips this check still can't drive the balance negative. */
export function assertCreditsAvailable(tenantId: number, cents: number): void {
  const balance = getEmailBalanceCents(tenantId);
  if (balance < cents) {
    throw new EmailCreditsError(
      `Insufficient email credits: balance is ${balance}c, need ${cents}c.`,
    );
  }
}

/**
 * Grant credits to a tenant (+balance, one ledger row). The ONLY way a
 * balance ever goes up in this task — there is no payment/card code here;
 * admin allocation (and, later, real auto-topup execution) call this.
 */
export function grantCredits(
  tenantId: number,
  cents: number,
  actor: string,
  reason: "topup" | "adjustment" | "auto_topup" = "topup",
): void {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Grant amount must be a positive whole number of cents.");
  }
  mutateBalance(tenantId, cents, reason, { note: actor });
}

/**
 * Record a metered spend against a campaign send (-balance, one ledger row,
 * reason 'send'). Call only after `assertCreditsAvailable` — this also
 * re-guards internally (via `mutateBalance`'s negative-balance check) so a
 * caller bug can't drive the balance below zero; on insufficient balance it
 * throws `EmailCreditsError` and writes nothing.
 */
export function recordCreditSpend(
  tenantId: number,
  cents: number,
  campaignId: number,
  actor: string,
): void {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Spend amount must be a positive whole number of cents.");
  }
  mutateBalance(tenantId, -cents, "send", { campaignId, note: actor });
}

/** A tenant's ledger, newest first. */
export function listLedger(tenantId: number, limit = 50): LedgerRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT id, tenant_id, delta_cents, reason, campaign_id, balance_after_cents, note, created_at
       FROM email_credit_ledger WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(tenantId, limit) as Array<{
    id: number;
    tenant_id: number;
    delta_cents: number;
    reason: string;
    campaign_id: number | null;
    balance_after_cents: number;
    note: string | null;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    deltaCents: r.delta_cents,
    reason: r.reason,
    campaignId: r.campaign_id,
    balanceAfterCents: r.balance_after_cents,
    note: r.note,
    createdAt: r.created_at,
  }));
}
