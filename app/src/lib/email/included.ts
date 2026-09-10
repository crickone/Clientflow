import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";
import { currentMonthKey } from "@/lib/monthlyCap";

/**
 * The monthly INCLUDED-SENDS tranche: how much email the base subscription
 * already pays for before a single credit is spent.
 *
 * Same free-tranche-then-overflow shape AI already uses (tenant_ai_cap +
 * chargeOverflow in @/lib/ai/usage), applied to recipients instead of cents:
 * the first N recipient-sends in a calendar month are absorbed by the
 * operator, and only the remainder is priced at the per-1000 rate and debited
 * from prepaid credits (@/lib/email/credits). At the default 5000/month a
 * small clinic never sees a credit balance at all, which is the point — the
 * meter should only appear for the tenants big enough to notice it.
 *
 * Why RECIPIENTS and not cents: the tranche has to be quotable to a client
 * ("5,000 emails a month included") and has to survive a change to the
 * per-1000 price without silently resizing itself. Cents would do neither.
 *
 * This module owns the tranche and nothing else — it never touches a balance.
 * `credits.ts` sees only the billable remainder this file computes, which is
 * why a tenant inside their allowance can send with a zero balance.
 */

/** platform_settings key for the global (not per-tenant) monthly included-sends allowance. */
export const EMAIL_INCLUDED_KEY = "email_included_per_month";

/** 5000 recipient-sends a month, included in the base subscription. */
export const DEFAULT_EMAIL_INCLUDED_PER_MONTH = 5000;

const MAX_EMAIL_INCLUDED_PER_MONTH = 1_000_000; // sanity ceiling, same reasoning as MAX_EMAIL_PRICE_PER_1000_CENTS

/** The global monthly allowance, falling back to the default when never customised. */
export function getEmailIncludedPerMonth(): number {
  const raw = getPlatformSetting(EMAIL_INCLUDED_KEY);
  if (raw == null) return DEFAULT_EMAIL_INCLUDED_PER_MONTH;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_EMAIL_INCLUDED_PER_MONTH;
}

/** Admin-only setter — bounds-checked here, not in the caller (same reasoning as setEmailPricePer1000Cents). */
export function setEmailIncludedPerMonth(sends: number): void {
  if (!Number.isInteger(sends) || sends < 0 || sends > MAX_EMAIL_INCLUDED_PER_MONTH) {
    throw new Error(
      `Included sends must be a whole number between 0 and ${MAX_EMAIL_INCLUDED_PER_MONTH}.`,
    );
  }
  setPlatformSetting(EMAIL_INCLUDED_KEY, String(sends));
}

/** This tenant's monthly allowance: their sparse override if they have one, else the global default. */
export function getTenantIncludedSends(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT included_sends FROM tenant_email_included WHERE tenant_id = ?")
    .get(tenantId) as { included_sends: number } | undefined;
  return row?.included_sends ?? getEmailIncludedPerMonth();
}

/** Give one tenant a different allowance (a sales concession, or a big list on a custom deal). */
export function setTenantIncludedSends(tenantId: number, sends: number): void {
  if (!Number.isInteger(sends) || sends < 0 || sends > MAX_EMAIL_INCLUDED_PER_MONTH) {
    throw new Error(
      `Included sends must be a whole number between 0 and ${MAX_EMAIL_INCLUDED_PER_MONTH}.`,
    );
  }
  controlSqlite
    .prepare(
      `INSERT INTO tenant_email_included (tenant_id, included_sends, updated_at)
       VALUES (?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET
         included_sends = excluded.included_sends, updated_at = excluded.updated_at`,
    )
    .run(tenantId, sends);
}

/** Drop a tenant's override, returning them to the global allowance. */
export function clearTenantIncludedSends(tenantId: number): void {
  controlSqlite.prepare("DELETE FROM tenant_email_included WHERE tenant_id = ?").run(tenantId);
}

/** Recipient-sends already made this calendar month. No row for a new month = 0, which is how the allowance resets. */
export function getSentThisMonth(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT sent_count FROM email_usage WHERE tenant_id = ? AND yyyymm = ?")
    .get(tenantId, currentMonthKey()) as { sent_count: number } | undefined;
  return row?.sent_count ?? 0;
}

/** How many of this month's allowance are left (0 once it's used up). */
export function includedRemaining(tenantId: number): number {
  return Math.max(0, getTenantIncludedSends(tenantId) - getSentThisMonth(tenantId));
}

/**
 * Split the next `recipients` sends into the free part and the billable part.
 *
 * Pure given (allowance, already-sent) — it does NOT consume anything, so it's
 * safe to call for a quote (precheckCampaign) and again for the real thing.
 * `recordSent` is what actually moves the counter.
 */
export function splitBillable(
  tenantId: number,
  recipients: number,
): { free: number; billable: number } {
  if (!Number.isInteger(recipients) || recipients < 0) {
    throw new Error("Recipient count must be a non-negative whole number.");
  }
  const free = Math.min(recipients, includedRemaining(tenantId));
  return { free, billable: recipients - free };
}

/**
 * Count sends against the monthly allowance. Called for EVERY send, free or
 * billable — a send inside the tranche costs no credits but must still consume
 * allowance, or the tranche would never run out.
 *
 * One upsert, so a concurrent campaign can't lose an increment (SQLite
 * serialises writers; `sent_count = sent_count + excluded.sent_count` is
 * computed by the DB, not read-modify-written in JS).
 */
export function recordSent(tenantId: number, recipients: number): void {
  if (!Number.isInteger(recipients) || recipients <= 0) return;
  controlSqlite
    .prepare(
      `INSERT INTO email_usage (tenant_id, yyyymm, sent_count, updated_at)
       VALUES (?, ?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id, yyyymm) DO UPDATE SET
         sent_count = sent_count + excluded.sent_count,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, currentMonthKey(), recipients);
}
