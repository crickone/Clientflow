// src/lib/marketing/seasonalCalendar.ts
// Curated marketing-relevant dates for Ireland + Irish/Celtic season bands.
// Pure: no AI, no DB, no I/O. Region is IE-only this slice.

export type CalKind = "public-holiday" | "awareness-day" | "season";
export type Season = "spring" | "summer" | "autumn" | "winter";

export interface CalDate {
  id: string;
  name: string;
  kind: Exclude<CalKind, "season">;
  iso: string; // YYYY-MM-DD
  angle: string; // generic, wellness-leaning hint used to seed the Kit + prime the radar
}
export interface SeasonBand { season: Season; months: number[]; startIso: string }

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** JS Date in UTC to avoid TZ drift; day-of-week 0=Sun..6=Sat. */
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** nth (1-based) given weekday (0=Sun..6=Sat) in month m. */
function nthWeekday(y: number, m: number, weekday: number, nth: number): number {
  const first = dow(y, m, 1);
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}
function lastWeekday(y: number, m: number, weekday: number): number {
  const last = daysInMonth(y, m);
  const lastDow = dow(y, m, last);
  return last - ((lastDow - weekday + 7) % 7);
}
/** Add `add` days to a UTC date, return {year,month,day}. */
function addDays(y: number, m: number, d: number, add: number) {
  const t = new Date(Date.UTC(y, m - 1, d + add));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Anonymous Gregorian ("Meeus/Jones/Butcher") algorithm. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return { month, day };
}

export function seasonForMonth(m: number): Season {
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter"; // Nov, Dec, Jan
}

export function catalogForYear(year: number): { dates: CalDate[]; seasons: SeasonBand[] } {
  const easter = easterSunday(year);
  const easterMon = addDays(year, easter.month, easter.day, 1);
  const mothers = addDays(year, easter.month, easter.day, -21); // 4th Sun of Lent (IE/UK)

  const dates: CalDate[] = [
    // public holidays (IE)
    { id: "new-year", name: "New Year's Day", kind: "public-holiday", iso: iso(year, 1, 1), angle: "New-year transformation challenge / fresh-start kickstart" },
    { id: "st-brigids", name: "St Brigid's Day", kind: "public-holiday", iso: iso(year, 2, nthWeekday(year, 2, 1, 1)), angle: "Start-of-spring reset" },
    { id: "st-patricks", name: "St Patrick's Day", kind: "public-holiday", iso: iso(year, 3, 17), angle: "Short 'Lucky' kickstart week" },
    { id: "easter-monday", name: "Easter Monday", kind: "public-holiday", iso: iso(easterMon.year, easterMon.month, easterMon.day), angle: "Spring-into-summer prep" },
    { id: "may-day", name: "May Bank Holiday", kind: "public-holiday", iso: iso(year, 5, nthWeekday(year, 5, 1, 1)), angle: "Summer-countdown program launch" },
    { id: "june-bh", name: "June Bank Holiday", kind: "public-holiday", iso: iso(year, 6, nthWeekday(year, 6, 1, 1)), angle: "Mid-year momentum push" },
    { id: "august-bh", name: "August Bank Holiday", kind: "public-holiday", iso: iso(year, 8, nthWeekday(year, 8, 1, 1)), angle: "End-of-summer last-push" },
    { id: "october-bh", name: "October Bank Holiday", kind: "public-holiday", iso: iso(year, 10, lastWeekday(year, 10, 1)), angle: "Autumn re-commit" },
    { id: "christmas", name: "Christmas Day", kind: "public-holiday", iso: iso(year, 12, 25), angle: "Pre-Christmas / New-Year-waitlist build" },
    { id: "st-stephens", name: "St Stephen's Day", kind: "public-holiday", iso: iso(year, 12, 26), angle: "Post-Christmas reset waitlist" },
    // awareness / marketing days
    { id: "valentines", name: "Valentine's Day", kind: "awareness-day", iso: iso(year, 2, 14), angle: "Partner / bring-a-friend offer" },
    { id: "intl-womens-day", name: "International Women's Day", kind: "awareness-day", iso: iso(year, 3, 8), angle: "Women's strength / community focus" },
    { id: "mothers-day-ie", name: "Mother's Day", kind: "awareness-day", iso: iso(mothers.year, mothers.month, mothers.day), angle: "Gift-a-membership / mums' program" },
    { id: "fathers-day", name: "Father's Day", kind: "awareness-day", iso: iso(year, 6, nthWeekday(year, 6, 0, 3)), angle: "Gift-a-membership / dads' program" },
    { id: "intl-mens-day", name: "International Men's Day", kind: "awareness-day", iso: iso(year, 11, 19), angle: "Men's health / strength focus" },
    { id: "back-to-school", name: "Back to School / Routine", kind: "awareness-day", iso: iso(year, 9, 1), angle: "Back-to-routine reset program" },
    { id: "black-friday", name: "Black Friday", kind: "awareness-day", iso: iso(year, 11, addDays(year, 11, nthWeekday(year, 11, 4, 4), 1).day), angle: "Best-offer-of-the-year membership deal" },
  ];

  const seasons: SeasonBand[] = [
    { season: "spring", months: [2, 3, 4], startIso: iso(year, 2, 1) },
    { season: "summer", months: [5, 6, 7], startIso: iso(year, 5, 1) },
    { season: "autumn", months: [8, 9, 10], startIso: iso(year, 8, 1) },
    { season: "winter", months: [11, 12, 1], startIso: iso(year, 11, 1) },
  ];

  return { dates, seasons };
}

export function upcomingDates(fromIso: string, days: number, year?: number): CalDate[] {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const y = year ?? from.getUTCFullYear();
  const end = new Date(from.getTime() + days * 86400000);
  // include this year's and (for year-end wrap) next year's catalog
  const pool = [...catalogForYear(y).dates, ...catalogForYear(y + 1).dates];
  return pool
    .filter((d) => {
      const dt = new Date(`${d.iso}T00:00:00Z`);
      return dt >= from && dt <= end;
    })
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}
