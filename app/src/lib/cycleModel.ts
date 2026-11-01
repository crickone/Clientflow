// Pure cycle-tracking model: dates, cycle lengths, the predicted next period,
// the phase of the cycle and what to expect in it. Shared by the member's app
// and the coach's view; no server-only.
//
// What this deliberately does NOT do: predict ovulation or fertile days. That
// is a fertility prediction, which puts an app into medical-device territory
// in the EU. A period prediction from the member's own history, and a note on
// how each phase tends to feel, do not.

export interface Period {
  id: number;
  /** YYYY-MM-DD */
  startDay: string;
  /** YYYY-MM-DD, or null while the period is still on. */
  endDay: string | null;
}

/** One day's check-in. Each scale is 1 (low / none) to 3 (high / a lot); null is not answered. */
export interface DayLog {
  day: string;
  energy: number | null;
  mood: number | null;
  sleep: number | null;
  pain: number | null;
  cravings: number | null;
  note: string | null;
}

export const DAY_FIELDS = ["energy", "mood", "sleep", "pain", "cravings"] as const;
export type DayField = (typeof DAY_FIELDS)[number];

/** The three answers for each field, in the order they're shown (1, 2, 3). */
export const DAY_SCALE: Record<DayField, { label: string; options: [string, string, string] }> = {
  energy: { label: "Energy", options: ["Low", "OK", "High"] },
  mood: { label: "Mood", options: ["Low", "OK", "Good"] },
  sleep: { label: "Sleep", options: ["Poor", "OK", "Good"] },
  pain: { label: "Cramps or pain", options: ["None", "Some", "A lot"] },
  cravings: { label: "Cravings", options: ["None", "Some", "A lot"] },
};

export function isDayField(x: string): x is DayField {
  return (DAY_FIELDS as readonly string[]).includes(x);
}

export const DEFAULT_CYCLE_DAYS = 28;
export const DEFAULT_PERIOD_DAYS = 5;
/** A gap between two period starts outside this range is not a cycle (a missed log, or a gap in tracking). */
const MIN_CYCLE = 15;
const MAX_CYCLE = 60;
/** A period that was never ended is treated as over after this many days. */
const MAX_OPEN_PERIOD = 10;

// ---- dates ---------------------------------------------------------------

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * 86_400_000);
}

/** b - a in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function isDayKey(x: unknown): x is string {
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(toUtc(x));
}

// ---- periods -------------------------------------------------------------

export function sortPeriods(periods: Period[]): Period[] {
  return [...periods].sort((a, b) => (a.startDay < b.startDay ? -1 : a.startDay > b.startDay ? 1 : 0));
}

/** The last day of a period: its end, or the start plus the usual length when it was never ended. */
export function periodEnd(p: Period, today: string, usualLength: number = DEFAULT_PERIOD_DAYS): string {
  if (p.endDay) return p.endDay;
  const assumed = addDays(p.startDay, Math.max(1, usualLength) - 1);
  // A period that is still open and recent is on until today.
  if (daysBetween(p.startDay, today) < MAX_OPEN_PERIOD) return today > assumed ? today : assumed;
  return assumed;
}

/** The period that covers today, if any. */
export function periodOn(periods: Period[], today: string): Period | null {
  const usual = averagePeriodLength(periods);
  return sortPeriods(periods).find((p) => p.startDay <= today && today <= periodEnd(p, today, usual)) ?? null;
}

/** Days between consecutive period starts that look like real cycles, oldest first. */
export function cycleLengths(periods: Period[]): number[] {
  const sorted = sortPeriods(periods);
  const out: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const n = daysBetween(sorted[i - 1].startDay, sorted[i].startDay);
    if (n >= MIN_CYCLE && n <= MAX_CYCLE) out.push(n);
  }
  return out;
}

/** The average of the last six cycles, or the default until there are two periods logged. */
export function averageCycleLength(periods: Period[]): number {
  const lens = cycleLengths(periods).slice(-6);
  if (lens.length === 0) return DEFAULT_CYCLE_DAYS;
  return Math.round(lens.reduce((s, n) => s + n, 0) / lens.length);
}

export function averagePeriodLength(periods: Period[]): number {
  const lens = periods.filter((p) => p.endDay).map((p) => daysBetween(p.startDay, p.endDay!) + 1).filter((n) => n >= 1 && n <= 14).slice(-6);
  if (lens.length === 0) return DEFAULT_PERIOD_DAYS;
  return Math.round(lens.reduce((s, n) => s + n, 0) / lens.length);
}

// ---- phases --------------------------------------------------------------

export type Phase = "period" | "follicular" | "mid" | "luteal";

export const PHASE_LABEL: Record<Phase, string> = {
  period: "Period",
  follicular: "After your period",
  mid: "Mid-cycle",
  luteal: "Before your period",
};

/** What each phase tends to feel like, in plain words. Typical, not a rule. */
export const PHASE_NOTE: Record<Phase, string> = {
  period:
    "Energy is often lowest in the first day or two. Lighter sessions, walking and mobility work are fine. Iron-rich food helps. Train hard if you feel up to it; rest if you don't.",
  follicular:
    "Energy and recovery usually pick up in the week after your period. A good time for heavier lifts, new personal bests and harder sessions.",
  mid: "Many people feel strongest and most sociable around the middle of the cycle. Joints can be a little looser, so warm up well before heavy or explosive work.",
  luteal:
    "In the week or so before your period, sleep, mood and appetite often change, and hard sessions can feel harder. Keep training, but expect a little less, and eat enough. Cravings are normal.",
};

export function phaseFor(dayOfCycle: number, cycleLength: number, periodLength: number): Phase {
  if (dayOfCycle <= periodLength) return "period";
  const midStart = Math.round(cycleLength * 0.46);
  const midEnd = Math.round(cycleLength * 0.57);
  if (dayOfCycle < midStart) return "follicular";
  if (dayOfCycle <= midEnd) return "mid";
  return "luteal";
}

// ---- the member's picture today ------------------------------------------

export interface CycleStatus {
  /** The last period logged, or null before the first. */
  lastStart: string | null;
  /** Day 1 is the first day of the last period. Null before the first period. */
  dayOfCycle: number | null;
  cycleLength: number;
  periodLength: number;
  /** How many cycles the average comes from. 0 means it is the default. */
  cyclesKnown: number;
  phase: Phase | null;
  /** The period covering today, if one is on. */
  onPeriod: Period | null;
  /** Day 1, 2, 3... of the period that is on; null otherwise. */
  periodDay: number | null;
  /** Predicted start of the next period, or null before the first period. */
  nextStart: string | null;
  /** Days until the prediction; negative when it is late. */
  daysToNext: number | null;
}

export function cycleStatus(periods: Period[], today: string): CycleStatus {
  const sorted = sortPeriods(periods).filter((p) => p.startDay <= today);
  const cycleLength = averageCycleLength(sorted);
  const periodLength = averagePeriodLength(sorted);
  const last = sorted[sorted.length - 1] ?? null;
  if (!last) {
    return { lastStart: null, dayOfCycle: null, cycleLength, periodLength, cyclesKnown: 0, phase: null, onPeriod: null, periodDay: null, nextStart: null, daysToNext: null };
  }
  const dayOfCycle = daysBetween(last.startDay, today) + 1;
  const on = periodOn(sorted, today);
  // Once the predicted day has passed, the next prediction is a cycle on from
  // the last one, so a late period reads "late" for a while and then rolls on.
  let nextStart = addDays(last.startDay, cycleLength);
  while (daysBetween(today, nextStart) < -7) nextStart = addDays(nextStart, cycleLength);
  const phase: Phase = on ? "period" : phaseFor(Math.min(dayOfCycle, cycleLength), cycleLength, periodLength);
  return {
    lastStart: last.startDay,
    dayOfCycle,
    cycleLength,
    periodLength,
    cyclesKnown: cycleLengths(sorted).slice(-6).length,
    phase,
    onPeriod: on,
    periodDay: on ? daysBetween(on.startDay, today) + 1 : null,
    nextStart,
    daysToNext: daysBetween(today, nextStart),
  };
}

/** The one line under "Cycle" on the Home screen. */
export function statusLine(s: CycleStatus): string {
  if (s.dayOfCycle === null) return "Log your first period to start";
  if (s.onPeriod) return `Period, day ${s.periodDay}`;
  if (s.daysToNext === null) return `Day ${s.dayOfCycle}`;
  if (s.daysToNext < 0) return `Day ${s.dayOfCycle} · period ${-s.daysToNext} day${s.daysToNext === -1 ? "" : "s"} later than expected`;
  if (s.daysToNext === 0) return `Day ${s.dayOfCycle} · period expected today`;
  return `Day ${s.dayOfCycle} · next period in about ${s.daysToNext} day${s.daysToNext === 1 ? "" : "s"}`;
}

// ---- calendar ------------------------------------------------------------

export interface CalendarDay {
  day: string;
  /** Day of the month, 1-31. */
  n: number;
  period: boolean;
  predicted: boolean;
  logged: boolean;
  today: boolean;
  future: boolean;
}

export interface CalendarMonth {
  /** YYYY-MM */
  key: string;
  label: string;
  /** 0 = Monday. How many blank cells come before the 1st. */
  offset: number;
  days: CalendarDay[];
}

/** The months from `monthsBack` ago to the month after today, with each day marked. */
export function calendar(periods: Period[], logs: Pick<DayLog, "day">[], status: CycleStatus, today: string, monthsBack = 2): CalendarMonth[] {
  const usual = status.periodLength;
  const periodDays = new Set<string>();
  for (const p of sortPeriods(periods)) {
    const end = periodEnd(p, today, usual);
    for (let d = p.startDay; d <= end; d = addDays(d, 1)) periodDays.add(d);
  }
  const predicted = new Set<string>();
  if (status.nextStart) {
    for (let i = 0; i < usual; i++) predicted.add(addDays(status.nextStart, i));
    // One more cycle on, so the month ahead is never blank.
    const after = addDays(status.nextStart, status.cycleLength);
    for (let i = 0; i < usual; i++) predicted.add(addDays(after, i));
  }
  const logged = new Set(logs.map((l) => l.day));

  const [ty, tm] = today.split("-").map(Number);
  const months: CalendarMonth[] = [];
  for (let k = -monthsBack; k <= 1; k++) {
    const first = new Date(Date.UTC(ty, tm - 1 + k, 1));
    const y = first.getUTCFullYear();
    const m = first.getUTCMonth();
    const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const days: CalendarDay[] = [];
    for (let n = 1; n <= count; n++) {
      const day = fromUtc(Date.UTC(y, m, n));
      days.push({ day, n, period: periodDays.has(day), predicted: !periodDays.has(day) && predicted.has(day), logged: logged.has(day), today: day === today, future: day > today });
    }
    months.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: first.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" }),
      offset: (first.getUTCDay() + 6) % 7,
      days,
    });
  }
  return months;
}

// ---- the coach's summary -------------------------------------------------

/** Average answer per field in each phase, for the coach. Null where nothing was logged. */
export function averagesByPhase(periods: Period[], logs: DayLog[], today: string): Record<Phase, Partial<Record<DayField, number>> & { days: number }> {
  const out = { period: { days: 0 }, follicular: { days: 0 }, mid: { days: 0 }, luteal: { days: 0 } } as Record<Phase, Partial<Record<DayField, number>> & { days: number }>;
  const sums: Record<Phase, Record<DayField, { s: number; n: number }>> = { period: blank(), follicular: blank(), mid: blank(), luteal: blank() };
  for (const log of logs) {
    const s = cycleStatus(periods, log.day);
    if (!s.phase) continue;
    out[s.phase].days++;
    for (const f of DAY_FIELDS) {
      const v = log[f];
      if (v === null) continue;
      sums[s.phase][f].s += v;
      sums[s.phase][f].n++;
    }
  }
  for (const ph of Object.keys(out) as Phase[]) {
    for (const f of DAY_FIELDS) {
      if (sums[ph][f].n) out[ph][f] = Math.round((sums[ph][f].s / sums[ph][f].n) * 10) / 10;
    }
  }
  return out;
}

function blank(): Record<DayField, { s: number; n: number }> {
  return { energy: { s: 0, n: 0 }, mood: { s: 0, n: 0 }, sleep: { s: 0, n: 0 }, pain: { s: 0, n: 0 }, cravings: { s: 0, n: 0 } };
}
