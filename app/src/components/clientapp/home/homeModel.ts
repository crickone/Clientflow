// app/src/components/clientapp/home/homeModel.ts
/**
 * What Home decides before it draws anything: the greeting, which state the
 * hero is in, the main lift's set chips, and which tiles have real data.
 * Pure (types only from the programs engine), so it can be tested on its own.
 */
import type { PlannedExercise, PlannedSet } from "@/lib/programs/types";

const TZ = "Europe/Dublin";

/** "Morning, Chris" (5 to 11), "Afternoon, Chris" (12 to 17), "Evening, Chris" otherwise; without a name, "Good morning". */
export function greeting(hour: number, firstName: string | null): string {
  const part = hour >= 5 && hour <= 11 ? "morning" : hour >= 12 && hour <= 17 ? "afternoon" : "evening";
  const name = firstName?.trim();
  return name ? `${part.charAt(0).toUpperCase()}${part.slice(1)}, ${name}` : `Good ${part}`;
}

/** The hour of day, 0 to 23, in Dublin. */
export function dublinHour(now: number): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(now));
  return Number(h) % 24;
}

/** "18:30" as Irish clocks read it: "6:30pm", "6pm", "12:15am". Anything that is not HH:MM comes back unchanged. */
export function clockLabel(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : `:${min}`}${h >= 12 ? "pm" : "am"}`;
}

export interface HeroChip {
  /** The set's place in its exercise, from 1, counting sets with no weight. */
  n: number;
  kg: string;
  reps: string;
  plus: boolean;
}

function repsText(s: PlannedSet): string {
  const base = `${s.reps}${s.repsMax !== null && s.repsMax !== s.reps ? `-${s.repsMax}` : ""}`;
  return s.amrap || s.drives ? `${base}+` : base;
}

const weighted = (s: PlannedSet): boolean => s.kg !== null && s.kg > 0;

/** The main lift's top working sets as chips: the first exercise with a lift (else the first with weights), its last three sets that have a weight. */
export function heroChips(exercises: PlannedExercise[], fmtKg: (kg: number) => string): HeroChip[] {
  const main = exercises.find((e) => e.lift !== null && e.sets.some(weighted)) ?? exercises.find((e) => e.sets.some(weighted));
  if (!main) return [];
  return main.sets
    .map((s, i) => ({ s, n: i + 1 }))
    .filter((x) => weighted(x.s))
    .slice(-3)
    .map(({ s, n }) => ({ n, kg: fmtKg(s.kg!), reps: repsText(s), plus: s.amrap || s.drives }));
}

/** "Week 3 of 12" as the eyebrow writes it: "Week 3". A repeat keeps its round: "Week 1, round 2". */
export function weekShort(label: string): string {
  return label.replace(/ of \d+/, "");
}

/** Sessions in a full round of the program: a cycle shorter than the program's length runs on, so its total is the cycle times the repeats (as My program counts it). 0 when it has no weeks. */
export function roundTotal(t: { sessions: number; lengthWeeks: number; weeks: number }): number {
  return t.weeks > 0 ? Math.round((t.sessions * Math.max(1, t.lengthWeeks)) / t.weeks) : 0;
}

export interface Ring {
  done: number;
  /** The round's total while the count fits inside it, else null. */
  total: number | null;
  /** How far round the ring goes, 0 to 1. */
  pct: number;
  /** The line under the number: "of 48 done", or "done" with no total to count against. */
  caption: string;
}

/** The program ring: sessions done of the round. Past the total (a repeating program runs on) it is full and reads "N done". */
export function ringStats(done: number, total: number): Ring {
  if (total > 0 && done <= total) return { done, total, pct: done / total, caption: `of ${total} done` };
  return { done, total: null, pct: total > 0 ? 1 : 0, caption: "done" };
}

export interface HeroSet {
  label: string;
  value: string;
  top: boolean;
}

/** The chips as a list: "Set 2  127.5 kg x 3", the last one "Top set" (the + set when the lift has one). */
export function heroSets(chips: HeroChip[], unit: string): HeroSet[] {
  return chips.map((c, i) => {
    const top = i === chips.length - 1;
    return { label: top ? "Top set" : `Set ${c.n}`, value: `${c.kg} ${unit} x ${c.reps}`, top };
  });
}

export type Hero =
  | { kind: "program"; eyebrow: string; title: string; chips: HeroChip[]; ring: Ring; action: "start" | "continue" }
  | { kind: "block_done"; title: "Block done" }
  | { kind: "plan"; title: string; programId: number; dayPosition: number }
  | { kind: "open"; title: string; sessionId: number }
  | { kind: "empty"; programsVisible: boolean };

/**
 * Which hero Home leads with. A workout already open (one that is not the
 * program's own) comes first, since only one can be open and Start would be
 * refused. Then the member's running program, then the coach's next workout,
 * then an invitation to start (left out for a paused program).
 */
export function pickHero(input: {
  open: { id: number; dayName: string } | null;
  program: { plan: { dayName: string; weekLabel: string; chips: HeroChip[]; today: boolean } | null; inProgress: boolean; sessionsDone: number; roundTotal: number } | null;
  next: { programId: number; dayPosition: number; dayName: string } | null;
  programsVisible: boolean;
  /** The member's program is paused (coach guided): nothing for them to start here, so no invitation to start. */
  paused?: boolean;
}): Hero | null {
  if (input.open) return { kind: "open", title: input.open.dayName, sessionId: input.open.id };
  if (input.program) {
    const p = input.program.plan;
    if (!p) return { kind: "block_done", title: "Block done" };
    return { kind: "program", eyebrow: `${p.today ? "Today" : "Next up"} · ${weekShort(p.weekLabel)}`, title: p.dayName, chips: p.chips, ring: ringStats(input.program.sessionsDone, input.program.roundTotal), action: input.program.inProgress ? "continue" : "start" };
  }
  if (input.next) return { kind: "plan", title: input.next.dayName, programId: input.next.programId, dayPosition: input.next.dayPosition };
  if (input.paused) return null;
  return { kind: "empty", programsVisible: input.programsVisible };
}

export interface Tile {
  key: "protein" | "habits" | "week" | "streak" | "class";
  label: string;
  value: string;
  /** How far along, 0 to 1, or null where there is no target. */
  pct: number | null;
}

const fraction = (done: number, of: number): number => Math.min(1, Math.max(0, of > 0 ? done / of : 0));

/** Only tiles with real data, in this order: protein, habits, week, streak, class. A tile that would read zero (nothing logged, nothing done yet) is left out. */
export function homeTiles(input: {
  protein: { got: number; target: number | null } | null;
  habits: { done: number; total: number } | null;
  week: { done: number; planned: number } | null;
  streak: number;
  nextClass: string | null;
}): Tile[] {
  const out: Tile[] = [];
  const { protein, habits, week } = input;
  if (protein && protein.target !== null && protein.target > 0 && protein.got > 0) {
    out.push({ key: "protein", label: "Protein today", value: `${Math.round(protein.got)} / ${Math.round(protein.target)} g`, pct: fraction(protein.got, protein.target) });
  }
  if (habits && habits.total > 0) out.push({ key: "habits", label: "Habits", value: `${habits.done} of ${habits.total}`, pct: fraction(habits.done, habits.total) });
  if (week && week.planned > 0 && week.done > 0) out.push({ key: "week", label: "This week", value: `${week.done} of ${week.planned}`, pct: fraction(week.done, week.planned) });
  if (input.streak > 0) out.push({ key: "streak", label: "Streak", value: `${input.streak} ${input.streak === 1 ? "week" : "weeks"}`, pct: null });
  if (input.nextClass) out.push({ key: "class", label: "Next class", value: input.nextClass, pct: null });
  return out;
}

export interface FeatureButton {
  key: "meal" | "class" | "checkin" | "habits";
  label: string;
  line: string;
  href: string;
  /** A small pill beside the label. */
  badge?: string;
}

/**
 * The plain buttons under the tiles. A meal and a class are always there (the
 * member app has both screens); the check-in and habits only where the business
 * has set them up.
 */
export function featureButtons(input: {
  proteinToday: number;
  nextClass: { name: string; when: string } | null;
  checkin: { due: boolean; daysLate: number; dueSince: string; next: string } | null;
  habits: { done: number; total: number } | null;
}): FeatureButton[] {
  const out: FeatureButton[] = [
    { key: "meal", label: "Log a meal", line: input.proteinToday > 0 ? `${Math.round(input.proteinToday)} g protein today` : "Add what you ate", href: "/app/nutrition" },
    { key: "class", label: "Book a class", line: input.nextClass ? `${input.nextClass.name}, ${input.nextClass.when}` : "See the timetable", href: "/app/timetable" },
  ];
  const c = input.checkin;
  if (c) {
    out.push({
      key: "checkin",
      label: "Check-in",
      line: c.due ? (c.daysLate === 0 ? "Takes a couple of minutes" : `Due since ${c.dueSince}`) : `Next ${c.next}`,
      href: "/app/checkin",
      ...(c.due ? { badge: "Due" } : {}),
    });
  }
  if (input.habits && input.habits.total > 0) out.push({ key: "habits", label: "Habits", line: `${input.habits.done} of ${input.habits.total} today`, href: "/app/habits" });
  return out;
}

/** "+6.4%", "-1.3%", "0%". */
function signedPct(n: number): string {
  const v = Number(n.toFixed(1));
  return v === 0 ? "0%" : `${v > 0 ? "+" : "-"}${Math.abs(v)}%`;
}

export interface StrengthTrend {
  value: string;
  points: { at: number; value: number }[];
}

/** The overall strength chart: the average rise in estimated max across the lifts logged twice. Null (the chart gives way to one quiet row) with fewer than two points or no lift logged twice. */
export function strengthTrend(points: { at: number; value: number }[], liftsLoggedTwice: number): StrengthTrend | null {
  if (points.length < 2 || liftsLoggedTwice < 1) return null;
  return { value: signedPct(points[points.length - 1].value), points };
}
