/**
 * Front desk preset pure helpers (no DB, no server imports; tested in
 * frontdesk.test.ts). The loaders live in frontdeskQueries.ts.
 */
import { pct } from "./stats";

const DAY = 86_400_000;
const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------- Dublin local time ----------

const dublinFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Dublin's offset from UTC at an instant, in ms. */
function dublinOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(dublinFmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Epoch ms of a Dublin wall-clock date and "HH:mm". */
export function dublinLocalToMs(dateIso: string, hhmm: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let ms = naive - dublinOffsetMs(naive);
  // Re-check at the candidate instant so a time just after a change settles.
  ms = naive - dublinOffsetMs(ms);
  return ms;
}

// ---------- cancellation lead time ----------

export const LEAD_BUCKETS = ["Under 24 hours", "1 to 3 days", "3 to 7 days", "Over a week", "After the start"] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

/** Bucket the gap between cancelling and the appointment start (ms, may be negative). */
export function leadTimeBucket(ms: number): LeadBucket {
  if (ms < 0) return "After the start";
  if (ms < DAY) return "Under 24 hours";
  if (ms < 3 * DAY) return "1 to 3 days";
  if (ms < 7 * DAY) return "3 to 7 days";
  return "Over a week";
}

// ---------- birthdays ----------

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export type Birthday = { id: number; name: string; date: string };

/**
 * Clients whose birthday falls in the `days` days starting at `todayIso`
 * (today included), sorted by date. A 29 Feb birthday lands on 28 Feb in a
 * non-leap year.
 */
export function upcomingBirthdays(
  clients: { id: number; name: string; dob: string | null }[],
  todayIso: string,
  days: number,
): Birthday[] {
  const start = Date.parse(`${todayIso}T00:00:00Z`);
  const byMonthDay = new Map<string, { id: number; name: string }[]>();
  for (const c of clients) {
    if (!c.dob || !/^\d{4}-\d{2}-\d{2}$/.test(c.dob)) continue;
    const md = c.dob.slice(5);
    const list = byMonthDay.get(md);
    if (list) list.push(c);
    else byMonthDay.set(md, [c]);
  }
  const out: Birthday[] = [];
  for (let i = 0; i < days; i++) {
    const iso = new Date(start + i * DAY).toISOString().slice(0, 10);
    const keys = [iso.slice(5)];
    if (iso.slice(5) === "02-28" && !isLeap(Number(iso.slice(0, 4)))) keys.push("02-29");
    for (const k of keys) {
      for (const c of byMonthDay.get(k) ?? []) out.push({ id: c.id, name: c.name, date: iso });
    }
  }
  return out;
}

// ---------- diary utilisation ----------

export type OpeningHour = { dow: number; closed: boolean; open?: string; close?: string };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Minutes the diary is open on a weekday (0 = Sunday); closed or unset days are 0. */
export function openMinutesFor(dow: number, openingHours: OpeningHour[]): number {
  const h = openingHours.find((x) => x.dow === dow);
  if (!h || h.closed || !h.open || !h.close) return 0;
  return Math.max(0, toMin(h.close) - toMin(h.open));
}

export type UtilisationRow = { label: string; booked: number; open: number; pct: number | null };

/**
 * Booked minutes over open minutes per weekday (Mon first) across the given
 * ISO days. Booked time on a closed day counts toward booked only.
 */
export function utilisationByWeekday(
  appts: { date: string; startTime: string; endTime: string }[],
  days: string[],
  openingHours: OpeningHour[],
): { rows: UtilisationRow[]; overallPct: number | null } {
  const booked = new Array<number>(7).fill(0);
  const open = new Array<number>(7).fill(0);
  const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
  const row = (dow: number) => (dow + 6) % 7;
  for (const iso of days) open[row(dowOf(iso))] += openMinutesFor(dowOf(iso), openingHours);
  for (const a of appts) {
    booked[row(dowOf(a.date))] += Math.max(0, toMin(a.endTime) - toMin(a.startTime));
  }
  const rows = WEEK_LABELS.map((label, i) => ({ label, booked: booked[i], open: open[i], pct: pct(booked[i], open[i]) }));
  const totalOpen = open.reduce((s, n) => s + n, 0);
  const totalBooked = rows.reduce((s, r) => s + (r.open > 0 ? r.booked : 0), 0);
  return { rows, overallPct: pct(totalBooked, totalOpen) };
}
