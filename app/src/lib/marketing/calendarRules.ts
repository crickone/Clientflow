// Pure rules for the seasonal calendar view: Irish school dates, how far
// ahead a campaign has to start, and what a campaign's status reads as.
// No I/O, so it is tested without the app (calendarRules.test.ts).

import { easterSunday } from "./seasonalCalendar";

/** Days before an occasion a campaign should start: landing page, emails and posts need a run-up. */
export const LEAD_DAYS = 21;

export interface SchoolDate {
  id: string;
  name: string;
  iso: string;
  angle: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function nthWeekday(y: number, m: number, weekday: number, nth: number): number {
  return 1 + ((weekday - dow(y, m, 1) + 7) % 7) + (nth - 1) * 7;
}
function lastWeekday(y: number, m: number, weekday: number): number {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - ((dow(y, m, last) - weekday + 7) % 7);
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** A weekend day moves to the Monday after. */
function weekdayOnOrAfter(y: number, m: number, d: number): string {
  const w = dow(y, m, d);
  return addDaysIso(isoOf(y, m, d), w === 6 ? 2 : w === 0 ? 1 : 0);
}

/**
 * The points of the Irish school year a gym or clinic plans around. These
 * are the TYPICAL dates under the standardised school calendar, not the
 * official list for a given year, and the page says so.
 */
export function schoolDatesForYear(year: number): SchoolDate[] {
  const easter = easterSunday(year);
  const easterIso = isoOf(year, easter.month, easter.day);
  const firstWedJune = nthWeekday(year, 6, 3, 1);
  return [
    { id: "school-jan-return", name: "Schools back after Christmas", iso: weekdayOnOrAfter(year, 1, 6), angle: "Back-to-routine: parents have their mornings again" },
    { id: "school-feb-midterm", name: "February mid-term break", iso: isoOf(year, 2, nthWeekday(year, 2, 1, 3)), angle: "Mid-term week: family sessions or a short kids' programme" },
    { id: "school-easter", name: "Easter school holidays", iso: addDaysIso(easterIso, -7), angle: "Two weeks of school holidays: daytime slots for parents and teens" },
    { id: "school-leaving-cert", name: "Leaving Cert begins", iso: isoOf(year, 6, firstWedJune), angle: "Exam stress and sleep: support for students and their parents" },
    { id: "school-oct-midterm", name: "October mid-term break", iso: isoOf(year, 10, lastWeekday(year, 10, 1)), angle: "Mid-term week alongside the bank holiday" },
    { id: "school-christmas", name: "Schools close for Christmas", iso: isoOf(year, 12, 22), angle: "Holiday routines slip: a plan to hold on through Christmas" },
  ];
}

export type StartTone = "ok" | "soon" | "late";

/**
 * When a campaign for an occasion on `iso` should start, and how that sits
 * against today. Null once the occasion itself has passed.
 */
export function startBy(iso: string, todayIso: string): { iso: string; tone: StartTone } | null {
  if (iso < todayIso) return null;
  const start = addDaysIso(iso, -LEAD_DAYS);
  if (todayIso > start) return { iso: start, tone: "late" };
  if (addDaysIso(todayIso, 7) >= start) return { iso: start, tone: "soon" };
  return { iso: start, tone: "ok" };
}

export type CampaignStatusValue = "building" | "ready" | "active" | "complete" | "archived";
export type StatusTone = "neutral" | "ready" | "live" | "done";

/** What a campaign's status reads as on the calendar; archived ones are not shown. */
export function statusLabel(status: string): { label: string; tone: StatusTone } | null {
  switch (status) {
    case "building":
      return { label: "Building", tone: "neutral" };
    case "ready":
      return { label: "Ready to launch", tone: "ready" };
    case "active":
      return { label: "Live", tone: "live" };
    case "complete":
      return { label: "Done", tone: "done" };
    default:
      return null;
  }
}

/** The twelve months to show: a calendar year, or the next twelve from `todayIso`. */
export function monthsToShow(view: { year: number } | { rollingFrom: string }): { year: number; month: number }[] {
  let y = "year" in view ? view.year : Number(view.rollingFrom.slice(0, 4));
  let m = "year" in view ? 1 : Number(view.rollingFrom.slice(5, 7));
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < 12; i++) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export { addDaysIso };
