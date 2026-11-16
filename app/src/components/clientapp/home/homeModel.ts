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
    .filter(weighted)
    .slice(-3)
    .map((s) => ({ kg: fmtKg(s.kg!), reps: repsText(s), plus: s.amrap || s.drives }));
}

export type Hero =
  | { kind: "program"; eyebrow: string; title: string; chips: HeroChip[]; action: "start" | "continue" }
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
  program: { plan: { dayName: string; weekLabel: string; chips: HeroChip[]; today: boolean } | null; inProgress: boolean } | null;
  next: { programId: number; dayPosition: number; dayName: string } | null;
  programsVisible: boolean;
  /** The member's program is paused (coach guided): nothing for them to start here, so no invitation to start. */
  paused?: boolean;
}): Hero | null {
  if (input.open) return { kind: "open", title: input.open.dayName, sessionId: input.open.id };
  if (input.program) {
    const p = input.program.plan;
    if (!p) return { kind: "block_done", title: "Block done" };
    return { kind: "program", eyebrow: `${p.today ? "Today" : "Next up"} · ${p.weekLabel}`, title: p.dayName, chips: p.chips, action: input.program.inProgress ? "continue" : "start" };
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
