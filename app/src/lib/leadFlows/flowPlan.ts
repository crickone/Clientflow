/**
 * The decisions the lead-flow engine makes, as pure functions.
 */
import { KEEP_ON_BOOKING } from "@/lib/automationModel";
import { INACTIVE_ROLES, type StageRole } from "@/lib/pipeline/roles";

/** Which of a lead's flows to stop. */
export type FlowScope = "all" | { except: readonly string[] } | { only: readonly string[] };

export interface ColumnEntryEffect {
  stop: FlowScope | "none";
  /** The flow to start (its own start stops every other flow). */
  start: string | null;
  /** Also drop a scheduled call's staff alerts and call-back check. */
  cancelCallRows: boolean;
}

/**
 * What a lead entering a column does to its flows.
 *  - a sale or a write-off (won, repeat, lost) stops everything;
 *  - a person (staff, or Adonis after approval) moving the card stops
 *    everything, then starts the column's flow when it has one;
 *  - an automatic move into a column with a flow switched on starts it,
 *    which stops every other flow;
 *  - a booking stops every flow but the booking ones; a no-show stops the
 *    booking ones;
 *  - any other automatic move leaves the flows alone (a reply stops flows
 *    on its own path; Message undelivered keeps the flow going by email).
 * `startFlow: false` is for Schedule a call, which starts its own flow.
 */
export function columnEntryEffect(input: { actor: string; role: StageRole | null; flowKey: string | null; startFlow: boolean }): ColumnEntryEffect {
  const start = input.startFlow ? input.flowKey : null;
  if (input.role && INACTIVE_ROLES.has(input.role)) return { stop: "all", start: null, cancelCallRows: true };
  if (input.actor === "user" || input.actor === "agent") return { stop: "all", start, cancelCallRows: true };
  if (start) return { stop: "all", start, cancelCallRows: false };
  if (input.role === "booked") return { stop: { except: KEEP_ON_BOOKING }, start: null, cancelCallRows: false };
  if (input.role === "no_show") return { stop: { only: KEEP_ON_BOOKING }, start: null, cancelCallRows: true };
  return { stop: "none", start: null, cancelCallRows: false };
}

/** The "everyone else" version of a step. */
export const OTHER_INTEREST = "other";

/** Whether any comma-separated keyword appears in the lead's interest text. */
export function interestMatches(keywords: string, interest: string | null | undefined): boolean {
  const text = (interest ?? "").toLowerCase();
  if (!text.trim()) return false;
  return keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => text.includes(k));
}

/**
 * The messages one lead gets. Versions of a step share its send time: the
 * first version whose keywords match the lead's interest goes, else the
 * "other" version. A message with no keywords always goes.
 */
export function pickForInterest<T extends { delayMs: number; matchInterest: string | null }>(messages: T[], interest: string | null | undefined): T[] {
  const chosen = new Map<number, T>();
  for (const m of messages) {
    const kw = m.matchInterest?.trim();
    if (!kw || kw.toLowerCase() === OTHER_INTEREST) continue;
    if (!chosen.has(m.delayMs) && interestMatches(kw, interest)) chosen.set(m.delayMs, m);
  }
  return messages.filter((m) => {
    const kw = m.matchInterest?.trim();
    if (!kw) return true;
    if (kw.toLowerCase() === OTHER_INTEREST) return !chosen.has(m.delayMs);
    return chosen.get(m.delayMs) === m;
  });
}

/**
 * When each step goes. Delays are offsets from the start (as the editor
 * shows them); each step is scheduled from the previous step's real time
 * plus the difference, so a step the sending hours hold back pushes the
 * later ones back with it. `fit` applies the sending hours. `firstAt`
 * replaces the first step's time (the morning after a picked call-back day).
 */
export function cascadeDueTimes(startAt: number, delaysMs: number[], fit: (at: number, index: number) => number, firstAt?: number): number[] {
  const out: number[] = [];
  delaysMs.forEach((d, i) => {
    if (i === 0) {
      out.push(fit(firstAt ?? startAt + d, 0));
      return;
    }
    out.push(fit(out[i - 1] + Math.max(0, d - delaysMs[i - 1]), i));
  });
  return out;
}

/** When the finish move happens: counted on from the last step that goes, else from the start. */
export function finishDueAt(startAt: number, dues: (number | null)[], delaysMs: number[], afterMs: number): number {
  for (let i = dues.length - 1; i >= 0; i--) {
    const due = dues[i];
    if (due != null) return due + Math.max(0, afterMs - delaysMs[i]);
  }
  return startAt + afterMs;
}

/**
 * The inbox triage read of a reply in the Thinking about it flow: wants to
 * book (category "booking") or asks to talk (high priority, which the
 * triage prompt keeps for hot, urgent messages) counts as a yes. Sensitive
 * and spam never do.
 */
export function isPositiveReply(t: { category: string; priority?: string | null }): boolean {
  if (t.category === "booking") return true;
  if (t.category === "sensitive" || t.category === "spam") return false;
  return t.priority === "high";
}
