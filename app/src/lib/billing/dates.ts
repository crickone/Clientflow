/**
 * Calendar-date helpers for billing. Dates are 'YYYY-MM-DD' strings representing
 * Europe/Dublin calendar days. Pure string/UTC arithmetic — never local Date
 * parsing (server TZ must not affect billing).
 */

const DUBLIN_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date in Dublin, e.g. '2026-07-21'. */
export function dublinToday(now = new Date()): string {
  return DUBLIN_FMT.format(now); // en-CA gives YYYY-MM-DD
}

export function dublinDayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate(); // month1 is 1-based
}

/**
 * One month after `dateStr`, landing on `anchorDay` clamped to the target
 * month's length (31 → Feb 28/29, Apr 30 …). Passing the anchor separately is
 * what lets a 31st-anchored subscription bounce back to the 31st after
 * February — deriving it from the clamped date would drift permanently.
 */
export function addMonthClamped(dateStr: string, anchorDay: number): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7)); // 1-based
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const day = Math.min(anchorDay, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** String compare works for ISO dates; wrapped for intent. */
export function cmpDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
