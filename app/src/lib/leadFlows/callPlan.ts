/**
 * Log a call and Schedule a call, as pure rules.
 */
import type { ColumnRef } from "./flowModel";
import { addDays, FLOW_TIME_ZONE } from "./sendingWindow";

export type CallOutcome = "no_answer" | "call_back" | "spoke" | "thinking" | "booked";

/** Log a call outcomes, in the order the dialog shows them, with the column each moves the lead to. */
export const CALL_OUTCOMES: { key: CallOutcome; label: string; column: ColumnRef }[] = [
  { key: "no_answer", label: "No answer", column: "key:no_answer" },
  { key: "call_back", label: "Call back later", column: "key:call_back" },
  // A person is handling them: Hot lead, which runs no flow.
  { key: "spoke", label: "Spoke to them", column: "role:engaged" },
  { key: "thinking", label: "Thinking about it", column: "key:thinking" },
  { key: "booked", label: "Booked a treatment", column: "role:booked" },
];

export function isCallOutcome(v: unknown): v is CallOutcome {
  return typeof v === "string" && CALL_OUTCOMES.some((o) => o.key === v);
}

export function outcomeColumn(o: CallOutcome): ColumnRef {
  return CALL_OUTCOMES.find((x) => x.key === o)!.column;
}

export type CallbackPick = "tomorrow" | "in_2_days" | "next_week";

export const CALLBACK_PICKS: { key: CallbackPick; label: string; days: number }[] = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "in_2_days", label: "In 2 days", days: 2 },
  { key: "next_week", label: "Next week", days: 7 },
];

export function callbackDay(pick: CallbackPick, today: string): string {
  return addDays(today, CALLBACK_PICKS.find((p) => p.key === pick)!.days);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to 2 March, so the date must round-trip.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function callbackDayError(day: string, today: string): string | null {
  if (!isIsoDate(day)) return "Pick a day.";
  if (day < today) return "Pick today or a later day.";
  return null;
}

export function callTimeError(callAt: number, now: number): string | null {
  if (!Number.isFinite(callAt)) return "Pick a time.";
  if (callAt <= now) return "Pick a time that has not passed yet.";
  return null;
}

/** The assignee's in-app alert goes this long before a scheduled call. */
export const CALL_STAFF_ALERT_MS = 10 * 60_000;
/** A scheduled call's length in the diary. */
export const CALL_LENGTH_MINUTES = 15;

/**
 * When a booked call's messages go. The first goes at booking; later ones
 * are counted back from the call (a delay of 1 hour = an hour before). Any
 * message the sending hours (`fit`) would push to or past the call time is
 * dropped (null), as is a reminder whose time has already passed.
 */
export function scheduleCallMessages(input: { now: number; callAt: number; delaysMs: number[]; fit: (at: number, index: number) => number }): (number | null)[] {
  return input.delaysMs.map((d, i) => {
    const wanted = i === 0 ? input.now : input.callAt - d;
    if (i > 0 && wanted <= input.now) return null;
    const at = input.fit(wanted, i);
    return at < input.callAt ? at : null;
  });
}

export function staffCallAlertAt(now: number, callAt: number): number {
  return Math.max(now, callAt - CALL_STAFF_ALERT_MS);
}

/** "Wednesday 2 December". */
export function formatCallDay(at: number, tz: string = FLOW_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(at));
}

/** "10:30". */
export function formatCallTime(at: number, tz: string = FLOW_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}
