import "server-only";

import { readKey, setKey } from "@/lib/settings";

/**
 * Operator-written direction attached to the seasonal calendar: the plan for
 * the year, plus per-month notes. This is what the operator already knows and
 * the AI can't infer — "September is the back-to-school push", "we're launching
 * the small-group programme in March, hold the discounting until then".
 *
 * Read back into the agent's business context (see @/lib/ai/businessContext) so
 * campaign copy follows the plan instead of guessing from the date alone.
 *
 * Stored as one settings row per year — no schema migration, and a year's plan
 * stays put when you browse to the next one.
 */

export interface CalendarNotes {
  /** The plan/direction for the whole year, free text. */
  yearPlan: string;
  /** Month number (1-12) → note for that month. */
  months: Record<string, string>;
}

const EMPTY: CalendarNotes = { yearPlan: "", months: {} };

function keyFor(year: number): string {
  return `marketing_calendar_notes_${year}`;
}

export function getCalendarNotes(year: number): CalendarNotes {
  const raw = readKey<Partial<CalendarNotes> | null>(keyFor(year), null);
  if (!raw || typeof raw !== "object") return { ...EMPTY, months: {} };
  const months: Record<string, string> = {};
  if (raw.months && typeof raw.months === "object") {
    for (const [m, note] of Object.entries(raw.months)) {
      if (typeof note === "string" && note.trim()) months[m] = note;
    }
  }
  return {
    yearPlan: typeof raw.yearPlan === "string" ? raw.yearPlan : "",
    months,
  };
}

/** Replace the whole year plan. Blank clears it. */
export function setYearPlan(year: number, plan: string): void {
  const current = getCalendarNotes(year);
  setKey(keyFor(year), { ...current, yearPlan: plan.trim().slice(0, 8000) });
}

/** Set (or clear, when blank) one month's note. */
export function setMonthNote(year: number, month: number, note: string): void {
  if (month < 1 || month > 12) return;
  const current = getCalendarNotes(year);
  const months = { ...current.months };
  const trimmed = note.trim().slice(0, 2000);
  if (trimmed) months[String(month)] = trimmed;
  else delete months[String(month)];
  setKey(keyFor(year), { ...current, months });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The plan as a compact briefing for the agent: the year's direction plus the
 * note for THIS month and the next two. Deliberately not the whole year — the
 * agent is writing something for now, and twelve months of notes would crowd
 * out the rest of the business context.
 */
export function getPlanBriefing(today: Date = new Date()): string {
  const year = today.getUTCFullYear();
  const notes = getCalendarNotes(year);
  const parts: string[] = [];

  if (notes.yearPlan.trim()) {
    parts.push(`Plan for ${year}:`, notes.yearPlan.trim());
  }

  const upcoming: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(year, today.getUTCMonth() + i, 1));
    // Roll into next year's notes once we cross December.
    const m = d.getUTCMonth() + 1;
    const y = d.getUTCFullYear();
    const source = y === year ? notes : getCalendarNotes(y);
    const note = source.months[String(m)];
    if (note) upcoming.push(`${MONTH_NAMES[m - 1]} ${y}: ${note}`);
  }
  if (upcoming.length > 0) {
    parts.push("", "What's planned for the months ahead:", ...upcoming);
  }

  return parts.join("\n");
}
