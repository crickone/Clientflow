/**
 * When lead follow-ups may go out. Pure: no DB, no server-only, so it loads
 * under the plain-tsx test runner.
 *
 * A business sets one window for every flow: days of the week plus a start
 * and an end time, in Irish time. A message due outside it goes at the start
 * of the next window; nothing is dropped. A business that has saved no hours
 * keeps the behaviour from before the setting existed: WhatsApp between 09:00
 * and 21:00 every day, email at any time (see fitToWindow).
 */

export const FLOW_TIME_ZONE = "Europe/Dublin";

export interface SendingWindow {
  /** Days messages may go: 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** "HH:mm", local time. */
  start: string;
  /** "HH:mm", local time, exclusive. Later than start. */
  end: string;
}

/** Before a business saves its own hours: WhatsApp 09:00-21:00 every day. */
export const LEGACY_WHATSAPP_WINDOW: SendingWindow = { days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "21:00" };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhmm(s: unknown): s is string {
  return typeof s === "string" && HHMM.test(s);
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parts(at: number, tz: string): Record<string, string> {
  return Object.fromEntries(formatter(tz).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
}

/** The local date ("YYYY-MM-DD"), weekday and minute of the day at an instant. */
export function localParts(at: number, tz: string = FLOW_TIME_ZONE): { date: string; weekday: number; minutes: number } {
  const p = parts(at, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAY[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** How far local time is ahead of UTC at an instant, in ms. */
function offsetAt(at: number, tz: string): number {
  const p = parts(at, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a local wall-clock time happens on a date. The second pass
 * settles a first guess that landed on the other side of a clock change.
 */
export function zonedTimeToUtc(date: string, hhmm: string, tz: string = FLOW_TIME_ZONE): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The first moment at or after `at` inside the window. A window with no days never holds anything back. */
export function nextSendTime(at: number, w: SendingWindow, tz: string = FLOW_TIME_ZONE): number {
  if (w.days.length === 0) return at;
  const { date } = localParts(at, tz);
  for (let i = 0; i <= 7; i++) {
    const day = addDays(date, i);
    if (!w.days.includes(weekdayOf(day))) continue;
    const open = zonedTimeToUtc(day, w.start, tz);
    const close = zonedTimeToUtc(day, w.end, tz);
    if (at < open) return open;
    if (at < close) return at;
  }
  return at;
}

/**
 * When a follow-up on `channel` may go, at or after `at`. With hours saved,
 * they hold every channel. With none saved: WhatsApp 09:00-21:00 every day,
 * email straight away (the behaviour before the setting existed).
 */
export function fitToWindow(at: number, channel: string, w: SendingWindow | null, tz: string = FLOW_TIME_ZONE): number {
  if (w) return nextSendTime(at, w, tz);
  return channel === "whatsapp" ? nextSendTime(at, LEGACY_WHATSAPP_WINDOW, tz) : at;
}

/** The start of sending hours on a date ("that morning"), whatever the weekday; 09:00 with no hours saved. */
export function morningOf(date: string, w: SendingWindow | null, tz: string = FLOW_TIME_ZONE): number {
  return zonedTimeToUtc(date, w?.start ?? "09:00", tz);
}

/** The last millisecond of a local date. */
export function endOfLocalDay(date: string, tz: string = FLOW_TIME_ZONE): number {
  return zonedTimeToUtc(addDays(date, 1), "00:00", tz) - 1;
}

/** Today's local date at an instant. */
export function todayIn(at: number, tz: string = FLOW_TIME_ZONE): string {
  return localParts(at, tz).date;
}
