import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { createPrepaidLedger } from "@/lib/billing/prepaidLedger";

/**
 * Prepaid voice credits — the third product on the shared prepaid-credit
 * mechanism (@/lib/billing/prepaidLedger), after email sends and AI usage, and
 * the reason that mechanism was extracted instead of hand-rolled a third time.
 *
 * `allowNegative` is ON, matching AI rather than email: a call's true cost is
 * only known when it ends, so the last call through the gate may overshoot
 * into a small debt (bounded by one call's maximum duration) that then blocks
 * the next one until a top-up clears it. Refusing after the fact isn't an
 * option — the minutes have already been spoken.
 *
 * The one column with no counterpart in the other two ledgers is
 * `trial_seconds_used`: the one-off free evaluation minutes, which are
 * consumed once and never reset (unlike the monthly included-minutes tranche
 * in ./usage.ts). It lives on this table rather than tenant_addons because it
 * is a consumption counter, and this is the table that already exists per
 * tenant for exactly that.
 *
 * Ledger + kill switch ONLY — no pricing (./pricing.ts), no tranche or cap
 * (./usage.ts), and no card/payment code: balances move up via
 * `grantVoiceCredits` (admin allocation today, auto-topup execution once
 * CreatePay lands) and down via `recordVoiceSpend`.
 */

/** Thrown when a tenant can't cover further voice usage. */
export class VoiceCreditsError extends Error {
  constructor(
    message = "Your voice minutes are used up and there are no voice credits left. Top up to keep calling.",
  ) {
    super(message);
    this.name = "VoiceCreditsError";
  }
}

const ledger = createPrepaidLedger({
  balanceTable: "voice_credits",
  ledgerTable: "voice_credit_ledger",
  allowNegative: true,
  insufficient: (balance, wouldBe) =>
    new VoiceCreditsError(
      `Insufficient voice credits: balance is ${balance}c, this spend would take it to ${wouldBe}c.`,
    ),
});

/** A tenant's current voice-credit balance (cents). Sparse row: never-granted reads as 0. */
export function getVoiceBalanceCents(tenantId: number): number {
  return ledger.getBalanceCents(tenantId);
}

/** Grant credits (+balance, one ledger row) — admin allocation, and later auto-topup execution. */
export function grantVoiceCredits(
  tenantId: number,
  cents: number,
  actor: string,
  reason: "topup" | "adjustment" | "auto_topup" = "topup",
): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Grant amount must be a positive whole number of cents.");
  }
  return ledger.mutate(tenantId, cents, reason, { note: actor });
}

/**
 * Record a metered call's spend (−balance, one ledger row, reason 'usage').
 * May go negative — see the file header. `note` carries the call reference so
 * a disputed line on a statement can be traced back to one conversation.
 */
export function recordVoiceSpend(tenantId: number, cents: number, note?: string | null): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Spend amount must be a positive whole number of cents.");
  }
  return ledger.mutate(tenantId, -cents, "usage", { note: note ?? null });
}

/** Platform-admin kill switch — blocks all voice for a tenant independent of balance (abuse/compliance/a complaint). */
export function isVoiceSuspended(tenantId: number): boolean {
  const row = controlSqlite
    .prepare("SELECT voice_suspended FROM voice_credits WHERE tenant_id = ?")
    .get(tenantId) as { voice_suspended: number } | undefined;
  return !!row?.voice_suspended;
}

/** Admin-only setter — config-only upsert (no ledger row). `actor` is for the caller's audit log, not stored here. */
export function setVoiceSuspended(tenantId: number, suspended: boolean, actor: string): void {
  void actor;
  controlSqlite
    .prepare(
      `INSERT INTO voice_credits (tenant_id, voice_suspended, updated_at)
       VALUES (?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET voice_suspended = excluded.voice_suspended, updated_at = excluded.updated_at`,
    )
    .run(tenantId, suspended ? 1 : 0);
}

/** Free evaluation seconds this tenant has already used. Sparse row: never-called reads as 0. */
export function getTrialSecondsUsed(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT trial_seconds_used FROM voice_credits WHERE tenant_id = ?")
    .get(tenantId) as { trial_seconds_used: number } | undefined;
  return row?.trial_seconds_used ?? 0;
}

/** Add to the trial counter. One upsert (`+ excluded`), so concurrent calls can't lose an increment. */
export function addTrialSecondsUsed(tenantId: number, seconds: number): void {
  if (!Number.isInteger(seconds) || seconds <= 0) return;
  controlSqlite
    .prepare(
      `INSERT INTO voice_credits (tenant_id, trial_seconds_used, updated_at)
       VALUES (?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET
         trial_seconds_used = trial_seconds_used + excluded.trial_seconds_used,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, seconds);
}

export interface VoiceLedgerRow {
  id: number;
  tenantId: number;
  deltaCents: number;
  reason: string;
  balanceAfterCents: number;
  note: string | null;
  createdAt: number;
}

/** A tenant's voice-credit ledger, newest first. */
export function listVoiceLedger(tenantId: number, limit = 50): VoiceLedgerRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT id, tenant_id, delta_cents, reason, balance_after_cents, note, created_at
       FROM voice_credit_ledger WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(tenantId, limit) as Array<{
    id: number;
    tenant_id: number;
    delta_cents: number;
    reason: string;
    balance_after_cents: number;
    note: string | null;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    deltaCents: r.delta_cents,
    reason: r.reason,
    balanceAfterCents: r.balance_after_cents,
    note: r.note,
    createdAt: r.created_at,
  }));
}
