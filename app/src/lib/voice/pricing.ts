import "server-only";

import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/**
 * What a voice call costs the client. Pure pricing rules + the platform
 * settings behind them — no DB rows, no balances, no entitlement (see
 * ./usage.ts and ./credits.ts for those).
 *
 * The model, and why it isn't the AI model: a voice minute is sold like an
 * email send (a service, priced with real margin over a provider cost of
 * roughly 12-20c/minute all-in), NOT like an AI token (a visible commodity
 * passed through at cost + 5%). The €50/month add-on carries 60 included
 * minutes so it buys something rather than being a pure access fee, and only
 * minutes beyond that are metered.
 *
 * Two rounding rules, both there to stop arguments rather than to make money:
 *   - a call shorter than MIN_BILLABLE_SECONDS bills NOTHING. Voicemail, no
 *     answer and instant hangups are the bulk of an outbound dialler's calls
 *     and cost us a fraction of a cent; charging for them reads as sharp
 *     practice on an itemised statement.
 *   - everything else rounds UP to the whole minute, per call, which is how
 *     every telco statement a client has ever read works.
 */

export const VOICE_PRICE_PER_MINUTE_KEY = "voice_price_per_minute_cents";
export const VOICE_INCLUDED_MINUTES_KEY = "voice_included_minutes";
export const VOICE_TRIAL_MINUTES_KEY = "voice_trial_minutes";

/** 45c/minute ex-VAT — roughly a 65-70% gross margin over ElevenLabs + Twilio termination. */
export const DEFAULT_VOICE_PRICE_PER_MINUTE_CENTS = 45;

/** Minutes included every month with an ACTIVE voice add-on (about 20 leads at 3 minutes each). */
export const DEFAULT_VOICE_INCLUDED_MINUTES = 60;

/** One-off free evaluation minutes while the add-on is on 'trial' — they do NOT reset monthly. */
export const DEFAULT_VOICE_TRIAL_MINUTES = 20;

/** Under this, a call is free: voicemail, no-answer, instant hangup. */
export const MIN_BILLABLE_SECONDS = 20;

const MAX_PRICE_PER_MINUTE_CENTS = 2000; // €20/min — sanity ceiling
const MAX_MINUTES = 100_000;

function readSetting(key: string, fallback: number): number {
  const raw = getPlatformSetting(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function getVoicePricePerMinuteCents(): number {
  return readSetting(VOICE_PRICE_PER_MINUTE_KEY, DEFAULT_VOICE_PRICE_PER_MINUTE_CENTS);
}

export function setVoicePricePerMinuteCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_PRICE_PER_MINUTE_CENTS) {
    throw new Error(
      `Voice price must be a whole number of cents between 0 and ${MAX_PRICE_PER_MINUTE_CENTS}.`,
    );
  }
  setPlatformSetting(VOICE_PRICE_PER_MINUTE_KEY, String(cents));
}

export function getVoiceIncludedMinutes(): number {
  return readSetting(VOICE_INCLUDED_MINUTES_KEY, DEFAULT_VOICE_INCLUDED_MINUTES);
}

export function setVoiceIncludedMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) {
    throw new Error(`Included minutes must be a whole number between 0 and ${MAX_MINUTES}.`);
  }
  setPlatformSetting(VOICE_INCLUDED_MINUTES_KEY, String(minutes));
}

export function getVoiceTrialMinutes(): number {
  return readSetting(VOICE_TRIAL_MINUTES_KEY, DEFAULT_VOICE_TRIAL_MINUTES);
}

export function setVoiceTrialMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) {
    throw new Error(`Trial minutes must be a whole number between 0 and ${MAX_MINUTES}.`);
  }
  setPlatformSetting(VOICE_TRIAL_MINUTES_KEY, String(minutes));
}

/**
 * Billable minutes for ONE call of `seconds` — the whole rounding policy, in
 * one pure function so the metering path, the cost estimate a dial-time gate
 * needs, and any future statement/report can never round differently.
 */
export function billedMinutesFor(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < MIN_BILLABLE_SECONDS) return 0;
  return Math.ceil(seconds / 60);
}

/** What `minutes` cost at the current price. */
export function costForMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.ceil(minutes) * getVoicePricePerMinuteCents();
}
