import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/**
 * Prepaid AI-credit ledger + margin (control plane) — the money layer for AI
 * usage that runs BEYOND a tenant's monthly free tranche (`tenant_ai_cap`,
 * default €25, absorbed by the operator). Overflow is billed to this prepaid
 * balance at raw provider cost + a small margin (`getAiMarginBp`, default 5%).
 *
 * Deliberately a near-clone of `@/lib/email/credits`: an `assert`/`record`
 * bracket around the metered action, a sparse per-tenant balance row, the
 * GLOBAL margin in `platform_settings`, and the same money-safety invariant —
 * every balance mutation (grant or spend) is ONE `controlSqlite.transaction()`
 * that reads the balance, computes the new one, writes it, and inserts exactly
 * one ledger row carrying that same `balance_after_cents`. SQLite serialises
 * writers, so concurrent AI calls can't interleave a read-compute-write.
 *
 * ONE deliberate divergence from the email ledger: a `usage` debit is allowed
 * to drive the balance NEGATIVE (`allowNegative`). Email knows a send's cost
 * up front and refuses before sending; an AI call's cost is only known AFTER
 * the tokens are burned, so the pre-check (`assertAiAllowed` in `./usage`) lets
 * a call through while there's ANY headroom, and this records the true cost
 * even when the last call overshoots. A negative balance then blocks the next
 * call until a top-up clears the debt — the overshoot is bounded by one call's
 * `max_tokens`, so it's small.
 *
 * Ledger + margin ONLY — no card/payment code. Balances move up via
 * `grantAiCredits` (admin allocation, and later auto-topup execution once
 * CreatePay lands) and down via `recordAiSpend`.
 */

/** platform_settings key for the global (not per-tenant) AI credit margin, in basis points over raw provider cost. */
export const AI_MARGIN_KEY = "ai_credit_margin_bp";

/** 500 bp = 5.00% markup over the raw Anthropic/OpenRouter cost — the platform keeps the spread, the client pays cost×1.05. */
export const DEFAULT_AI_MARGIN_BP = 500;

const MAX_AI_MARGIN_BP = 10_000; // 100% — sanity ceiling

/** Sanity ceiling for auto-topup threshold/amount (cents) — €10,000. */
const MAX_AI_AUTO_TOPUP_CENTS = 1_000_000;

/** Thrown when a tenant is over its free tranche AND has no credits to cover further AI usage. */
export class AiCreditsError extends Error {
  constructor(
    message = "Your monthly free AI allowance is used up and there are no AI credits left. Top up your AI credits, or an admin can add some.",
  ) {
    super(message);
    this.name = "AiCreditsError";
  }
}

/** The global AI margin (basis points), falling back to `DEFAULT_AI_MARGIN_BP` when never customised. */
export function getAiMarginBp(): number {
  const raw = getPlatformSetting(AI_MARGIN_KEY);
  if (raw == null) return DEFAULT_AI_MARGIN_BP;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_AI_MARGIN_BP;
}

/** Admin-only setter — bounds-checked here (not in the caller) so every caller gets the guarantee, same reasoning as email's `setEmailPricePer1000Cents`. */
export function setAiMarginBp(bp: number): void {
  if (!Number.isInteger(bp) || bp < 0 || bp > MAX_AI_MARGIN_BP) {
    throw new Error(`AI margin must be a whole number of basis points between 0 and ${MAX_AI_MARGIN_BP}.`);
  }
  setPlatformSetting(AI_MARGIN_KEY, String(bp));
}

/** Raw provider cost (cents) → what the client is billed for it. Rounded UP so the platform never under-charges on the margin. */
export function withMargin(rawCents: number): number {
  if (rawCents <= 0) return 0;
  return Math.ceil((rawCents * (10_000 + getAiMarginBp())) / 10_000);
}

/** A tenant's current AI-credit balance (cents). Sparse row: never-granted reads as 0. */
export function getAiBalanceCents(tenantId: number): number {
  const row = controlSqlite
    .prepare("SELECT balance_cents FROM ai_credits WHERE tenant_id = ?")
    .get(tenantId) as { balance_cents: number } | undefined;
  return row?.balance_cents ?? 0;
}

export interface AiAutoTopupConfig {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
}

/** A tenant's auto-topup config. Sparse row: defaults to disabled/0/0. The "balance fell below threshold → charge card" EXECUTION lives elsewhere (needs CreatePay) — this only persists the config. */
export function getAiAutoTopup(tenantId: number): AiAutoTopupConfig {
  const row = controlSqlite
    .prepare(
      "SELECT auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents FROM ai_credits WHERE tenant_id = ?",
    )
    .get(tenantId) as
    | { auto_topup_enabled: number; auto_topup_threshold_cents: number; auto_topup_amount_cents: number }
    | undefined;
  return {
    enabled: !!row?.auto_topup_enabled,
    thresholdCents: row?.auto_topup_threshold_cents ?? 0,
    amountCents: row?.auto_topup_amount_cents ?? 0,
  };
}

/** Bounds-checked here (not the caller). Config-only upsert — never touches balance_cents (a fresh row picks up its DEFAULT 0), so no ledger row / transaction needed. */
export function setAiAutoTopup(tenantId: number, cfg: AiAutoTopupConfig): void {
  const { enabled, thresholdCents, amountCents } = cfg;
  if (!Number.isInteger(thresholdCents) || thresholdCents < 0 || thresholdCents > MAX_AI_AUTO_TOPUP_CENTS) {
    throw new Error(`Auto-topup threshold must be a whole number of cents between 0 and ${MAX_AI_AUTO_TOPUP_CENTS}.`);
  }
  if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > MAX_AI_AUTO_TOPUP_CENTS) {
    throw new Error(`Auto-topup amount must be a whole number of cents between 0 and ${MAX_AI_AUTO_TOPUP_CENTS}.`);
  }
  if (enabled && amountCents <= 0) {
    throw new Error("Auto-topup amount must be greater than 0 when enabled.");
  }
  controlSqlite
    .prepare(
      `INSERT INTO ai_credits (tenant_id, auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents, updated_at)
       VALUES (?, ?, ?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET
         auto_topup_enabled = excluded.auto_topup_enabled,
         auto_topup_threshold_cents = excluded.auto_topup_threshold_cents,
         auto_topup_amount_cents = excluded.auto_topup_amount_cents,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, enabled ? 1 : 0, thresholdCents, amountCents);
}

/** Platform-admin kill switch — blocks all AI for a tenant independent of balance (abuse/compliance). Sparse row: never-suspended reads as false. */
export function isAiSuspended(tenantId: number): boolean {
  const row = controlSqlite
    .prepare("SELECT ai_suspended FROM ai_credits WHERE tenant_id = ?")
    .get(tenantId) as { ai_suspended: number } | undefined;
  return !!row?.ai_suspended;
}

/** Admin-only setter — config-only upsert (no ledger row). `actor` is for the caller's audit log (billing_events), not stored here (no column). */
export function setAiSuspended(tenantId: number, suspended: boolean, actor: string): void {
  void actor;
  controlSqlite
    .prepare(
      `INSERT INTO ai_credits (tenant_id, ai_suspended, updated_at)
       VALUES (?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET ai_suspended = excluded.ai_suspended, updated_at = excluded.updated_at`,
    )
    .run(tenantId, suspended ? 1 : 0);
}

export interface AiLedgerRow {
  id: number;
  tenantId: number;
  deltaCents: number;
  reason: "topup" | "usage" | "adjustment" | "refund" | "auto_topup" | string;
  balanceAfterCents: number;
  note: string | null;
  createdAt: number;
}

type AiLedgerReason = "topup" | "usage" | "adjustment" | "refund" | "auto_topup";

/**
 * The ONE place ai_credits.balance_cents is ever written — read → compute →
 * (guard) → write balance + insert one ledger row, all in a single
 * transaction. `allowNegative` skips the negative-balance guard for `usage`
 * debits (see the file header for why AI usage is allowed to overshoot).
 */
function mutateBalance(
  tenantId: number,
  deltaCents: number,
  reason: AiLedgerReason,
  opts: { note?: string | null; allowNegative?: boolean } = {},
): number {
  const run = controlSqlite.transaction(() => {
    const row = controlSqlite
      .prepare("SELECT balance_cents FROM ai_credits WHERE tenant_id = ?")
      .get(tenantId) as { balance_cents: number } | undefined;
    const currentBalance = row?.balance_cents ?? 0;
    const newBalance = currentBalance + deltaCents;
    if (newBalance < 0 && !opts.allowNegative) {
      throw new AiCreditsError(
        `Insufficient AI credits: balance is ${currentBalance}c, this spend would take it to ${newBalance}c.`,
      );
    }
    controlSqlite
      .prepare(
        `INSERT INTO ai_credits (tenant_id, balance_cents, updated_at)
         VALUES (?, ?, unixepoch() * 1000)
         ON CONFLICT(tenant_id) DO UPDATE SET balance_cents = excluded.balance_cents, updated_at = excluded.updated_at`,
      )
      .run(tenantId, newBalance);
    controlSqlite
      .prepare(
        `INSERT INTO ai_credit_ledger (tenant_id, delta_cents, reason, balance_after_cents, note)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tenantId, deltaCents, reason, newBalance, opts.note ?? null);
    return newBalance;
  });
  return run();
}

/** Grant credits to a tenant (+balance, one ledger row). Admin allocation + (later) auto-topup execution call this. */
export function grantAiCredits(
  tenantId: number,
  cents: number,
  actor: string,
  reason: "topup" | "adjustment" | "auto_topup" = "topup",
): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Grant amount must be a positive whole number of cents.");
  }
  return mutateBalance(tenantId, cents, reason, { note: actor });
}

/**
 * Record a metered AI-usage spend (−balance, one ledger row, reason 'usage').
 * Allowed to drive the balance negative (see the file header) — the pre-check
 * `assertAiAllowed` in `./usage` is the gate; this just records the true cost.
 * `note` typically carries the agentKey the spend was for.
 */
export function recordAiSpend(tenantId: number, cents: number, note?: string | null): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Spend amount must be a positive whole number of cents.");
  }
  return mutateBalance(tenantId, -cents, "usage", { note: note ?? null, allowNegative: true });
}

/** A tenant's AI-credit ledger, newest first. */
export function listAiLedger(tenantId: number, limit = 50): AiLedgerRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT id, tenant_id, delta_cents, reason, balance_after_cents, note, created_at
       FROM ai_credit_ledger WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
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
