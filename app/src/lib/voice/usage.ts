import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { assertUnderMonthlyCap, currentMonthKey, readTenantCapCents } from "@/lib/monthlyCap";
import { getTenantAddon } from "@/lib/billing/addons";
import {
  addTrialSecondsUsed,
  getTrialSecondsUsed,
  getVoiceBalanceCents,
  isVoiceSuspended,
  recordVoiceSpend,
  VoiceCreditsError,
} from "./credits";
import {
  billedMinutesFor,
  costForMinutes,
  getVoiceIncludedMinutes,
  getVoiceTrialMinutes,
} from "./pricing";

/**
 * Voice metering: the pre-dial gate and the post-call charge.
 *
 * Three allowances, consumed in this order, and the order is the product:
 *   1. TRIAL minutes — one-off, while the add-on is on 'trial'. Never reset.
 *      This is the evaluation: the client hears the agent ring their own
 *      mobile before any money changes hands.
 *   2. INCLUDED minutes — 60 a month with an ACTIVE add-on, reset by the
 *      calendar (a new yyyymm simply has no usage row yet).
 *   3. PREPAID credits — everything beyond, at the per-minute price.
 * Same free-tranche-then-overflow shape as AI (@/lib/ai/usage), with minutes
 * as the tranche unit instead of cents, for the same reason email's tranche
 * counts recipients: an allowance has to be quotable to a client and must not
 * silently resize itself when the price changes.
 *
 * The bracket every paid call passes: `assertVoiceAllowed` BEFORE dialling,
 * `meterVoiceCall` after the provider reports the call ended. The gate can
 * only ever be approximate — a call's true cost isn't known until it hangs up
 * — so the overshoot is bounded structurally instead: MAX_CALL_MINUTES is the
 * hard duration limit the dialler must hand the provider, which caps how far
 * past the monthly cap or a zero balance a single call can carry a tenant.
 *
 * Prepaid, never post-paid. An autonomous dialler billed to a card after the
 * fact is how a client discovers a four-figure month they never agreed to;
 * with prepaid credits the worst case is one over-run call.
 */

/** Thrown by the pre-dial gate. Distinct from VoiceCreditsError (a refused debit) so a caller can tell "not allowed to dial" from "the debit failed". */
export class VoiceCapError extends Error {
  constructor(message = "This account's voice allowance is used up. Top up voice credits to keep calling.") {
    super(message);
    this.name = "VoiceCapError";
  }
}

/** Thrown when the tenant has no voice add-on at all — a product/entitlement answer, not a money one. */
export class VoiceNotEnabledError extends Error {
  constructor(message = "The Voice Agent add-on isn't enabled for this account.") {
    super(message);
    this.name = "VoiceNotEnabledError";
  }
}

/** €150/month default backstop against a runaway dialler — admin-adjustable per tenant. */
export const DEFAULT_VOICE_CAP_CENTS = 15_000;

export const MIN_VOICE_CAP_CENTS = 0;
export const MAX_VOICE_CAP_CENTS = 500_000; // €5000 — sanity ceiling

/**
 * The hard per-call duration limit the dialler must pass to the provider.
 * This is what makes the pre-dial gate safe despite only knowing the cost
 * afterwards: a tenant can exceed their cap or balance by at most one call of
 * this length, never by an unbounded amount.
 */
export const MAX_CALL_MINUTES = 15;

export function getVoiceCapCents(tenantId: number): number {
  return readTenantCapCents("tenant_voice_cap", tenantId, DEFAULT_VOICE_CAP_CENTS);
}

export function setVoiceCapCents(tenantId: number, capCents: number): void {
  if (!Number.isInteger(capCents) || capCents < MIN_VOICE_CAP_CENTS || capCents > MAX_VOICE_CAP_CENTS) {
    throw new Error(
      `Voice cap must be a whole number of cents between ${MIN_VOICE_CAP_CENTS} and ${MAX_VOICE_CAP_CENTS}.`,
    );
  }
  controlSqlite
    .prepare(
      `INSERT INTO tenant_voice_cap (tenant_id, cap_cents, updated_at)
       VALUES (?, ?, unixepoch() * 1000)
       ON CONFLICT(tenant_id) DO UPDATE SET cap_cents = excluded.cap_cents, updated_at = excluded.updated_at`,
    )
    .run(tenantId, capCents);
}

export interface VoiceMonthUsage {
  seconds: number;
  billedMinutes: number;
  costCents: number;
  calls: number;
}

const EMPTY_MONTH: VoiceMonthUsage = { seconds: 0, billedMinutes: 0, costCents: 0, calls: 0 };

/** This calendar month's voice usage. No row for a new month = zeros, which is how the included-minutes tranche resets. */
export function getMonthUsage(tenantId: number): VoiceMonthUsage {
  const row = controlSqlite
    .prepare(
      "SELECT seconds, billed_minutes, cost_cents, calls FROM voice_usage WHERE tenant_id = ? AND yyyymm = ?",
    )
    .get(tenantId, currentMonthKey()) as
    | { seconds: number; billed_minutes: number; cost_cents: number; calls: number }
    | undefined;
  return row
    ? { seconds: row.seconds, billedMinutes: row.billed_minutes, costCents: row.cost_cents, calls: row.calls }
    : EMPTY_MONTH;
}

/** One upsert (`+ excluded`), so two calls ending at once can't lose an increment. */
function recordMonthUsage(
  tenantId: number,
  seconds: number,
  billedMinutes: number,
  costCents: number,
): void {
  controlSqlite
    .prepare(
      `INSERT INTO voice_usage (tenant_id, yyyymm, seconds, billed_minutes, cost_cents, calls, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, unixepoch() * 1000)
       ON CONFLICT(tenant_id, yyyymm) DO UPDATE SET
         seconds = seconds + excluded.seconds,
         billed_minutes = billed_minutes + excluded.billed_minutes,
         cost_cents = cost_cents + excluded.cost_cents,
         calls = calls + 1,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, currentMonthKey(), seconds, billedMinutes, costCents);
}

/** Monthly included minutes left (an ACTIVE add-on only — a trial has trial minutes instead). */
export function includedMinutesRemaining(tenantId: number): number {
  if (getTenantAddon(tenantId, "voice")?.status !== "active") return 0;
  return Math.max(0, getVoiceIncludedMinutes() - getMonthUsage(tenantId).billedMinutes);
}

/** One-off free evaluation seconds left (a TRIAL add-on only). */
export function trialSecondsRemaining(tenantId: number): number {
  if (getTenantAddon(tenantId, "voice")?.status !== "trial") return 0;
  return Math.max(0, getVoiceTrialMinutes() * 60 - getTrialSecondsUsed(tenantId));
}

/**
 * The gate every call passes BEFORE it is dialled. Allows the call when the
 * tenant is entitled, not suspended, under their monthly spend cap, and has
 * SOMETHING left to spend — trial seconds, included minutes, or a positive
 * credit balance.
 *
 * A tenant with the add-on but no credits and no allowance behaves exactly
 * like a hard stop, so this ships inert: nothing dials until an operator has
 * deliberately switched voice on for that tenant.
 */
export function assertVoiceAllowed(tenantId: number): void {
  const addon = getTenantAddon(tenantId, "voice");
  if (addon?.status !== "active" && addon?.status !== "trial") {
    throw new VoiceNotEnabledError();
  }
  if (isVoiceSuspended(tenantId)) {
    throw new VoiceCapError("Voice is currently suspended for this account.");
  }
  if (addon.status === "trial") {
    if (trialSecondsRemaining(tenantId) <= 0) {
      throw new VoiceCapError(
        "The free trial minutes for this account are used up. Switch the Voice Agent add-on to active to keep calling.",
      );
    }
    return;
  }
  // The runaway-dialler backstop, checked before the allowance so a tenant
  // with credits still can't spend past their cap.
  assertUnderMonthlyCap(getMonthUsage(tenantId).costCents, getVoiceCapCents(tenantId), () => new VoiceCapError(
    "This account has reached its monthly voice spend cap. Raise the cap to keep calling.",
  ));
  if (includedMinutesRemaining(tenantId) > 0) return;
  if (getVoiceBalanceCents(tenantId) > 0) return;
  throw new VoiceCapError();
}

export interface VoiceCallCharge {
  /** Whole minutes this call was billed at (0 for a sub-MIN_BILLABLE_SECONDS call). */
  billedMinutes: number;
  /** Of those, how many came out of trial or included allowance. */
  freeMinutes: number;
  /** What was actually debited from prepaid credits (cents). */
  chargedCents: number;
  /** Which allowance paid for it — for the call record and the operator-facing statement. */
  source: "trial" | "included" | "credits" | "free";
}

/**
 * Meter ONE finished call: record the usage and debit whatever falls beyond
 * the tenant's allowances. Call this from the provider's post-call webhook,
 * with the duration the provider reports (never a locally-timed one).
 *
 * Never throws on a refused debit — the minutes have already been spoken, so a
 * failure to charge must not lose the usage record. The debt simply sits on
 * the balance (voice credits allow a negative) and the pre-dial gate refuses
 * the NEXT call.
 */
export function meterVoiceCall(
  tenantId: number,
  opts: { seconds: number; ref?: string | null },
): VoiceCallCharge {
  const seconds = Math.max(0, Math.round(opts.seconds));
  const billedMinutes = billedMinutesFor(seconds);
  const addon = getTenantAddon(tenantId, "voice");

  // Sub-threshold: voicemail, no answer, instant hangup. Recorded (it still
  // happened, and the call count matters for reporting) but never charged.
  if (billedMinutes === 0) {
    recordMonthUsage(tenantId, seconds, 0, 0);
    if (addon?.status === "trial") addTrialSecondsUsed(tenantId, seconds);
    return { billedMinutes: 0, freeMinutes: 0, chargedCents: 0, source: "free" };
  }

  if (addon?.status === "trial") {
    recordMonthUsage(tenantId, seconds, billedMinutes, 0);
    addTrialSecondsUsed(tenantId, seconds);
    return { billedMinutes, freeMinutes: billedMinutes, chargedCents: 0, source: "trial" };
  }

  // Read the tranche BEFORE recording this call, so a call is never counted
  // against its own included-minutes headroom (same ordering as AI's
  // chargeOverflow reading usedBefore before recordUsage).
  const freeMinutes = Math.min(billedMinutes, includedMinutesRemaining(tenantId));
  const chargeable = billedMinutes - freeMinutes;
  const chargedCents = costForMinutes(chargeable);
  recordMonthUsage(tenantId, seconds, billedMinutes, chargedCents);
  if (chargedCents > 0) {
    try {
      recordVoiceSpend(tenantId, chargedCents, opts.ref ?? null);
    } catch (err) {
      // Only reachable if the ledger itself refuses (it allows negatives, so
      // in practice this is a DB-level failure). Log and keep the usage row:
      // an operator can reconcile from voice_usage vs the ledger.
      console.error(
        `[voice] credit debit failed for tenant ${tenantId} (${chargedCents}c, ref ${opts.ref ?? "-"}):`,
        err instanceof VoiceCreditsError ? err.message : err,
      );
    }
  }
  return {
    billedMinutes,
    freeMinutes,
    chargedCents,
    source: chargedCents > 0 ? "credits" : "included",
  };
}
