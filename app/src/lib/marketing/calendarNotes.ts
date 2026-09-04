import "server-only";

import { readKey, setKey } from "@/lib/settings";

/**
 * Operator-written direction attached to the seasonal calendar: a note per
 * month. This is what the operator already knows and the AI can't infer — "September is the back-to-school push", "we're launching
 * the small-group programme in March, hold the discounting until then".
 *
 * Read back into the agent's business context (see @/lib/ai/businessContext) so
 * campaign copy follows the plan instead of guessing from the date alone.
 *
 * Stored as one settings row per year — no schema migration, and a year's plan
 * stays put when you browse to the next one.
 */

export interface CalendarNotes {
  /** Month number (1-12) → the OPERATOR's note for that month. */
  months: Record<string, string>;
  /**
   * Month number (1-12) → lines written by the app when a campaign is created,
   * so the calendar records what's actually running. Kept in their own track so
   * they can never overwrite what the operator wrote.
   */
  campaignNotes: Record<string, string[]>;
}

/** How many auto lines to keep per month before dropping the oldest. */
const MAX_CAMPAIGN_NOTES_PER_MONTH = 8;

function keyFor(year: number): string {
  return `marketing_calendar_notes_${year}`;
}

export function getCalendarNotes(year: number): CalendarNotes {
  const raw = readKey<Partial<CalendarNotes> | null>(keyFor(year), null);
  if (!raw || typeof raw !== "object") return { months: {}, campaignNotes: {} };
  const months: Record<string, string> = {};
  if (raw.months && typeof raw.months === "object") {
    for (const [m, note] of Object.entries(raw.months)) {
      if (typeof note === "string" && note.trim()) months[m] = note;
    }
  }
  const campaignNotes: Record<string, string[]> = {};
  if (raw.campaignNotes && typeof raw.campaignNotes === "object") {
    for (const [m, lines] of Object.entries(raw.campaignNotes)) {
      if (!Array.isArray(lines)) continue;
      const clean = lines.filter((l): l is string => typeof l === "string" && !!l.trim());
      if (clean.length) campaignNotes[m] = clean;
    }
  }
  return { months, campaignNotes };
}

/**
 * Record what a campaign is doing, on the month it starts in. Written by the
 * app when a campaign is created (see lib/campaigns/store.createCampaign), so
 * the calendar reflects what's actually running rather than only what the
 * operator remembered to write down. Never touches the operator's own note.
 * De-duplicated, so re-running a create doesn't stack identical lines.
 */
export function addCampaignNote(year: number, month: number, line: string): void {
  if (month < 1 || month > 12) return;
  const text = line.trim().slice(0, 300);
  if (!text) return;
  const current = getCalendarNotes(year);
  const key = String(month);
  const existing = current.campaignNotes[key] ?? [];
  if (existing.includes(text)) return;
  const next = [...existing, text].slice(-MAX_CAMPAIGN_NOTES_PER_MONTH);
  setKey(keyFor(year), {
    ...current,
    campaignNotes: { ...current.campaignNotes, [key]: next },
  });
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

/** A note in the briefing is trimmed to keep the whole year affordable. */
const BRIEF_NOTE_MAX = 400;

function brief(note: string): string {
  const t = note.trim();
  return t.length > BRIEF_NOTE_MAX ? `${t.slice(0, BRIEF_NOTE_MAX - 1)}…` : t;
}

/**
 * The plan as a briefing for the agent.
 *
 * The month notes are now the ONLY place this direction lives, so the whole
 * year is included rather than a rolling window — that's what lets the agent
 * see the shape of the year ("we launch in March, so hold the discounting in
 * February") instead of just what's in front of it. Each note is trimmed, and
 * they're short by nature, so twelve of them stay affordable.
 *
 * The months from `today` onward are marked as upcoming and listed first: they
 * are what the agent is most likely writing for. Months already past stay in as
 * context, and the first few months of NEXT year are included too so a December
 * campaign can see January.
 */
export function getPlanBriefing(today: Date = new Date()): string {
  const year = today.getUTCFullYear();
  const notes = getCalendarNotes(year);
  const currentMonth = today.getUTCMonth() + 1;

  const upcoming: string[] = [];
  const earlier: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const note = notes.months[String(m)];
    // Campaigns already recorded for the month, so the agent knows what's
    // running and doesn't propose something that duplicates it.
    const running = notes.campaignNotes[String(m)] ?? [];
    if (!note && running.length === 0) continue;
    const bits = [
      note ? brief(note) : null,
      running.length ? `Already scheduled: ${running.map(brief).join("; ")}` : null,
    ].filter(Boolean);
    const line = `${MONTH_NAMES[m - 1]}: ${bits.join(" ")}`;
    if (m >= currentMonth) upcoming.push(line);
    else earlier.push(line);
  }

  // Early next year, so a campaign written in December can see January.
  const nextYear = getCalendarNotes(year + 1);
  const nextLines: string[] = [];
  for (let m = 1; m <= 3; m++) {
    const note = nextYear.months[String(m)];
    if (note) nextLines.push(`${MONTH_NAMES[m - 1]} ${year + 1}: ${brief(note)}`);
  }

  const parts: string[] = [];
  if (upcoming.length > 0) {
    parts.push(`The plan for the rest of ${year}, month by month:`, ...upcoming);
  }
  if (nextLines.length > 0) {
    parts.push(...(parts.length ? [""] : []), `Early ${year + 1}:`, ...nextLines);
  }
  if (earlier.length > 0) {
    parts.push(
      ...(parts.length ? [""] : []),
      `Earlier in ${year}, for context:`,
      ...earlier,
    );
  }

  return parts.join("\n");
}
