/**
 * Pure: the lead page's activity feed. Events (came in, purchases, stage
 * moves, calls, follow-up messages the flows sent) come from the server
 * (leadActivity.ts); messages live in the page's own state because sending
 * and drafting change them. This merges the two in time order and groups
 * them by day in Dublin time.
 */

export type ActivityKind = "came_in" | "arrived" | "purchase" | "stage" | "call" | "flow_message";
export type ActivityFilter = "all" | "messages" | "calls" | "purchases";

export interface ActivityEvent {
  key: string;
  kind: ActivityKind;
  at: number;
  title: string;
  detail?: string | null;
  /** A flow message that failed to send. */
  failed?: boolean;
}

export interface FeedMessage {
  id: number;
  at: number;
}

export type FeedItem<M extends FeedMessage> = { type: "event"; at: number; event: ActivityEvent } | { type: "message"; at: number; message: M };

export interface FeedDay<M extends FeedMessage> {
  day: string;
  label: string;
  items: FeedItem<M>[];
}

const TZ = "Europe/Dublin";
const dayKey = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const longDay = (at: number) => new Intl.DateTimeFormat("en-IE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(at));
const longDayYear = (at: number) =>
  new Intl.DateTimeFormat("en-IE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(at));

export function dayLabel(at: number, now: number): string {
  const d = dayKey(at);
  if (d === dayKey(now)) return "Today";
  if (d === dayKey(now - 86_400_000)) return "Yesterday";
  return (d.slice(0, 4) === dayKey(now).slice(0, 4) ? longDay(at) : longDayYear(at)).replace(",", "");
}

function keep(kind: ActivityKind | "message", filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "messages") return kind === "message" || kind === "flow_message";
  if (filter === "calls") return kind === "call";
  return kind === "purchase";
}

/** Oldest first, events before messages at the same moment, grouped by Dublin day. */
export function buildFeed<M extends FeedMessage>(events: ActivityEvent[], messages: M[], filter: ActivityFilter, now: number): FeedDay<M>[] {
  const items: FeedItem<M>[] = [
    ...events.filter((e) => keep(e.kind, filter)).map((event) => ({ type: "event" as const, at: event.at, event })),
    ...(keep("message", filter) ? messages.map((message) => ({ type: "message" as const, at: message.at, message })) : []),
  ];
  items.sort((a, b) => a.at - b.at || (a.type === b.type ? 0 : a.type === "event" ? -1 : 1));
  const days: FeedDay<M>[] = [];
  for (const it of items) {
    const day = dayKey(it.at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(it);
    else days.push({ day, label: dayLabel(it.at, now), items: [it] });
  }
  return days;
}

/** "Online: Black Friday: Sports massage (Stripe pi_123)." -> "Black Friday: Sports massage". */
export function paymentLabel(notes: string | null | undefined, packageName: string | null | undefined): string | null {
  const fromNotes = (notes ?? "")
    .replace(/^online:\s*/i, "")
    .replace(/\s*\((stripe|ref)[^)]*\)\.?\s*$/i, "")
    .replace(/\.$/, "")
    .trim();
  return packageName?.trim() || fromNotes || null;
}

/** The ad's campaign number is noise in a sentence: "Facebook ad (120250788598410442)" -> "Facebook ad". */
export function withoutAdNumber(arrival: string): string {
  return arrival.replace(/\s*\(\d{6,}\)$/, "");
}
