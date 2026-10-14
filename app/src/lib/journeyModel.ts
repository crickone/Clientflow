/**
 * A client's journey: everything that happened between them and the
 * business, oldest first, as one timeline. lib/clientJourney.ts gathers the
 * events from the database; this orders and groups them. Pure, so tested.
 */

export type JourneyKind =
  | "first-contact" // became a lead: where from, how they arrived
  | "stage" // moved on a pipeline
  | "message-in"
  | "message-out"
  | "purchase" // bought online
  | "payment"
  | "package"
  | "booked"
  | "treatment" // a session done
  | "missed" // no-show or cancelled
  | "client"; // became a client

export type JourneyEvent = {
  at: number;
  kind: JourneyKind;
  title: string;
  detail?: string;
};

/** Ms from a DB value that may be a Date, ms, seconds or an ISO date. */
export function toMs(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Oldest first; at the same moment, the cause before the effect (contact, then stage, then the rest). */
const ORDER: JourneyKind[] = ["first-contact", "client", "purchase", "stage", "payment", "package", "booked", "message-in", "message-out", "treatment", "missed"];

export function orderJourney(events: JourneyEvent[]): JourneyEvent[] {
  return [...events].sort((a, b) => a.at - b.at || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** Group by Irish calendar day for display, keeping order. */
export function groupByDay(events: JourneyEvent[]): { day: string; events: JourneyEvent[] }[] {
  const out: { day: string; events: JourneyEvent[] }[] = [];
  const key = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  for (const e of events) {
    const d = key(e.at);
    const last = out[out.length - 1];
    if (last && last.day === d) last.events.push(e);
    else out.push({ day: d, events: [e] });
  }
  return out;
}

/** An online purchase writes a payment row too; the purchase already says it, so drop that payment. */
export function isOnlinePurchasePayment(notes: string | null | undefined): boolean {
  return /^Online:/.test(notes ?? "");
}
