/**
 * The choices a member makes in the client app that aren't agreements:
 * whether they want news and offers (optional, never a condition of using
 * the app), and when their weekly check-in is due. Pure.
 */

import { addDays } from "@/lib/trainingProgress";

// ── news and offers ──

export type ConsentChannel = "email" | "sms";

export const CONSENT_CHANNELS: ConsentChannel[] = ["email", "sms"];

/** The exact words a member ticks. Kept with every answer so consent can be shown later. */
export function consentStatement(channel: ConsentChannel, businessName: string): string {
  return channel === "email"
    ? `Email me news and offers from ${businessName}. I can unsubscribe at any time.`
    : `Text or WhatsApp me news and offers from ${businessName}. I can stop these at any time.`;
}

export const CONSENT_LABEL: Record<ConsentChannel, string> = { email: "News and offers by email", sms: "News and offers by text or WhatsApp" };

export interface ConsentRow {
  channel: ConsentChannel;
  granted: boolean;
  at: number;
}

/** The current answer per channel: the latest row, or null when never asked. */
export function currentConsent(rows: ConsentRow[]): Record<ConsentChannel, { granted: boolean; at: number } | null> {
  const out: Record<ConsentChannel, { granted: boolean; at: number } | null> = { email: null, sms: null };
  for (const r of rows) {
    const cur = out[r.channel];
    if (!cur || r.at >= cur.at) out[r.channel] = { granted: r.granted, at: r.at };
  }
  return out;
}

// ── weekly check-in ──

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** 1 = Monday ... 7 = Sunday, for an Irish calendar day "YYYY-MM-DD". */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export interface CheckinState {
  /** The check-in day this week's check-in counts from. */
  since: string;
  /** The next check-in day after today's period. */
  next: string;
  /** No check-in sent since `since`. */
  due: boolean;
  /** Days since `since`, when due: 0 = today. */
  daysLate: number;
}

/**
 * A weekly check-in falls due on its weekday and stays due until one is
 * sent. Anything sent on or after the most recent check-in day counts.
 */
export function checkinState(weekday: number, today: string, lastSentDay: string | null): CheckinState {
  const back = (weekdayOf(today) - weekday + 7) % 7;
  const since = addDays(today, -back);
  const next = addDays(since, 7);
  const due = !lastSentDay || lastSentDay < since;
  return { since, next, due, daysLate: due ? back : 0 };
}

// ── check-in photos ──

const PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export function isPhotoName(name: string): boolean {
  return PHOTO_NAME.test(name);
}

/** A photo answer holds up to three stored file names, "|" between them. */
export function photoNames(value: string): string[] {
  return value
    .split("|")
    .map((s) => s.trim())
    .filter(isPhotoName)
    .slice(0, 3);
}
