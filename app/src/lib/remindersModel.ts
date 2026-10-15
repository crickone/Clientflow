/**
 * When the app sends a member a reminder, by push notification. Pure, so the
 * rules are tested without a clock or a phone. All times are Irish.
 *
 *   class      once, 15 minutes to 2 hours before a class they're booked into
 *   check-in   on check-in day from 9am if not sent, and again 2 days later
 *   habits     from 7pm if today's habits aren't all ticked
 *
 * Nothing goes out between 9pm and 8am except a class reminder (an early
 * class still needs one). Each reminder has a key so it's sent once.
 */

const TZ = "Europe/Dublin";

/** The Irish hour (0-23) at a moment. */
export function dublinHour(ms: number): number {
  return Number(new Date(ms).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ })) % 24;
}

/** The moment an Irish wall-clock date and time happens. */
export function dublinToMs(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Ireland is UTC+0 or UTC+1: read the offset at that moment and correct.
  const shown = new Date(guess).toLocaleString("en-GB", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const [dp, tp] = shown.split(", ");
  const [sd, sm, sy] = dp.split("/").map(Number);
  const [sh, smin] = tp.split(":").map(Number);
  const offset = Date.UTC(sy, sm - 1, sd, sh % 24, smin) - guess;
  return guess - offset;
}

export function quietHours(ms: number): boolean {
  const h = dublinHour(ms);
  return h >= 21 || h < 8;
}

/** A booked class is due a reminder from 2 hours before until 15 minutes before. */
export function classReminderDue(startMs: number, now: number): boolean {
  const left = startMs - now;
  return left > 15 * 60_000 && left <= 120 * 60_000;
}

export type CheckinNudge = { key: string; kind: "due" | "missed" } | null;

/** The check-in reminder due now, if any: on the day from 9am, then a nudge 2 days later. */
export function checkinNudge(state: { due: boolean; since: string; daysLate: number }, now: number): CheckinNudge {
  if (!state.due || quietHours(now) || dublinHour(now) < 9) return null;
  if (state.daysLate === 0) return { key: `checkin:${state.since}`, kind: "due" };
  if (state.daysLate === 2) return { key: `checkin-missed:${state.since}`, kind: "missed" };
  return null;
}

/** The habits reminder due now, if any: from 7pm when today isn't finished. */
export function habitNudge(today: string, done: number, total: number, now: number): string | null {
  if (total === 0 || done >= total || quietHours(now) || dublinHour(now) < 19) return null;
  return `habits:${today}`;
}

export interface Prefs {
  classes: boolean;
  checkins: boolean;
  habits: boolean;
}

export const DEFAULT_PREFS: Prefs = { classes: true, checkins: true, habits: true };
