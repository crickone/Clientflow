// Pure training-progress maths: Irish calendar weeks, streaks, the strength
// trend and the weekly plan. Shared by server and client (no server-only).

const TZ = "Europe/Dublin";
const DAY_MS = 86400000;

/** "YYYY-MM-DD" for the Irish calendar day a moment falls on. */
export function dateKey(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  return new Date(keyToUtc(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(key: string): number {
  const d = new Date(keyToUtc(key)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The Monday of the week a day key falls in. */
export function mondayOf(key: string): string {
  return addDays(key, 1 - isoWeekday(key));
}

export interface SessionStat {
  finishedAt: number;
  sets: number;
  volume: number;
}

export interface WeekTotal {
  weekStart: string;
  workouts: number;
  sets: number;
  volume: number;
}

/** The last `weeks` Irish calendar weeks, oldest first, ending with this one. Empty weeks included. */
export function weeklyTotals(sessions: SessionStat[], weeks: number, now: number): WeekTotal[] {
  const thisMonday = mondayOf(dateKey(now));
  const out: WeekTotal[] = [];
  const index = new Map<string, WeekTotal>();
  for (let i = weeks - 1; i >= 0; i--) {
    const w = { weekStart: addDays(thisMonday, -7 * i), workouts: 0, sets: 0, volume: 0 };
    out.push(w);
    index.set(w.weekStart, w);
  }
  for (const s of sessions) {
    const w = index.get(mondayOf(dateKey(s.finishedAt)));
    if (!w) continue;
    w.workouts++;
    w.sets += s.sets;
    w.volume += s.volume;
  }
  return out;
}

/**
 * Weeks in a row with at least one workout, counting back from this week.
 * This week not trained yet doesn't break the streak; last week missed does.
 */
export function weekStreak(finishedAt: number[], now: number): number {
  const weeks = new Set(finishedAt.map((t) => mondayOf(dateKey(t))));
  let cursor = mondayOf(dateKey(now));
  if (!weeks.has(cursor)) cursor = addDays(cursor, -7);
  let n = 0;
  while (weeks.has(cursor)) {
    n++;
    cursor = addDays(cursor, -7);
  }
  return n;
}

export interface LiftPoint {
  at: number;
  e1rm: number;
}

/**
 * One line for "am I getting stronger": at the end of each week, the average
 * of every lift's best estimated max so far against its first session. A lift
 * joins the average from its second session, so trying a new exercise once
 * doesn't drag the line down with a 0%.
 */
export function strengthCurve(lifts: LiftPoint[][], weeks: WeekTotal[]): { at: number; value: number }[] {
  const series = lifts
    .filter((l) => l.length > 0)
    .map((l) => l.map((p) => ({ ...p, week: mondayOf(dateKey(p.at)) })).sort((a, b) => a.at - b.at));
  const out: { at: number; value: number }[] = [];
  for (const w of weeks) {
    const changes: number[] = [];
    for (const l of series) {
      // A lift counts from its second session: one session is a starting point, not a change.
      if (l.length < 2 || l[1].week > w.weekStart || l[0].e1rm <= 0) continue;
      let best = l[0].e1rm;
      for (const p of l) if (p.week <= w.weekStart && p.e1rm > best) best = p.e1rm;
      changes.push(best / l[0].e1rm - 1);
    }
    if (changes.length === 0) continue;
    out.push({ at: keyToUtc(w.weekStart) + 3 * DAY_MS, value: Math.round((changes.reduce((a, b) => a + b, 0) / changes.length) * 1000) / 10 });
  }
  return out;
}

/** First session's best vs the best since, for one lift. */
export function liftChange(points: LiftPoint[]): { first: number; best: number; kg: number; pct: number } | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const first = sorted[0].e1rm;
  const best = Math.max(...sorted.map((p) => p.e1rm));
  return { first, best, kg: Math.round((best - first) * 2) / 2, pct: first > 0 ? Math.round((best / first - 1) * 1000) / 10 : 0 };
}

export function signed(n: number, unit = ""): string {
  const v = Number(n.toFixed(1));
  if (v === 0) return `0${unit}`;
  return `${v > 0 ? "+" : "-"}${Math.abs(v)}${unit}`;
}

// ---- The weekly plan --------------------------------------------------------

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function parseWeekdays(raw: string | null | undefined): number[] {
  return [...new Set((raw ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b);
}

export type PlanStatus = "done" | "planned" | "today" | "missed" | "rest";

export interface PlanDay {
  date: string;
  weekday: number;
  label: string;
  status: PlanStatus;
  /** The programme day planned here, or the workout logged here. */
  title: string | null;
  /** Programme day position for a planned day, so it can be started. */
  dayPosition: number | null;
}

/**
 * This week, Monday to Sunday. Days with a logged workout are done. The
 * member's training days from today on get the programme's days in order,
 * starting from the one after their last; a training day already past with
 * nothing logged is missed. A workout done on a rest day still counts as done.
 */
export function planWeek(input: {
  now: number;
  weekdays: number[];
  dayNames: string[];
  nextDayPosition: number;
  logged: { at: number; title: string }[];
}): PlanDay[] {
  const today = dateKey(input.now);
  const monday = mondayOf(today);
  const doneBy = new Map<string, string[]>();
  for (const l of input.logged) {
    const k = dateKey(l.at);
    doneBy.set(k, [...(doneBy.get(k) ?? []), l.title]);
  }
  let next = input.dayNames.length ? input.nextDayPosition % input.dayNames.length : 0;
  const out: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const weekday = i + 1;
    const done = doneBy.get(date);
    const training = input.weekdays.includes(weekday);
    if (done) {
      out.push({ date, weekday, label: WEEKDAY_SHORT[i], status: "done", title: done.join(", "), dayPosition: null });
    } else if (training && date < today) {
      out.push({ date, weekday, label: WEEKDAY_SHORT[i], status: "missed", title: null, dayPosition: null });
    } else if (training && input.dayNames.length) {
      out.push({ date, weekday, label: WEEKDAY_SHORT[i], status: date === today ? "today" : "planned", title: input.dayNames[next], dayPosition: next });
      next = (next + 1) % input.dayNames.length;
    } else {
      out.push({ date, weekday, label: WEEKDAY_SHORT[i], status: "rest", title: null, dayPosition: null });
    }
  }
  return out;
}

/** The programme day after the last one logged, or the first. */
export function nextDayAfter(lastPosition: number | null, dayCount: number): number {
  if (dayCount <= 0) return 0;
  if (lastPosition === null) return 0;
  return (lastPosition + 1) % dayCount;
}
