/**
 * Communication preset pure helpers (no DB, no server imports; tested in
 * communication.test.ts). The loaders live in communicationQueries.ts.
 */
import { firstResponseTimes, median, type Msg } from "./stats";

/** One message (lead, client or Gmail) reduced to what the widgets need. */
export type MsgRow = {
  /** `lead:<id>`, `client:<id>` or `thread:<gmailThreadId>`. */
  convo: string;
  direction: "inbound" | "outbound";
  atMs: number;
  channel: string | null;
  aiCategory: string | null;
  aiPriority: string | null;
  autoReplyStatus: string | null;
  triagedAtMs: number | null;
};

/** "42 min", "3.5 h", "2.1 days". */
export function formatDuration(minutes: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (minutes < 59.5) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  if (hours < 23.95) return `${trim(hours)} h`;
  const days = Math.round((minutes / 1440) * 10) / 10;
  return days === 1 ? "1 day" : `${days} days`;
}

/** Channel used for grouping and display; a missing channel is "other". */
export function channelOf(row: { channel: string | null }): string {
  return row.channel ?? "other";
}

const CHANNEL_LABELS: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", call: "Call", other: "Other" };
export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel.charAt(0).toUpperCase() + channel.slice(1);
}

const CATEGORY_LABELS: Record<string, string> = {
  new_lead: "New enquiry",
  booking: "Booking",
  existing_client: "Existing client",
  faq: "Question",
  sensitive: "Sensitive",
  spam: "Spam",
  other: "Other",
};
export function categoryLabel(cat: string | null): string {
  if (cat === null) return "Not triaged";
  return CATEGORY_LABELS[cat] ?? "Other";
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`;
}

const toMsg = (r: MsgRow): Msg => ({ convo: r.convo, direction: r.direction, atMs: r.atMs, channel: channelOf(r) });

/** Median first-response time for inbound runs that started in [fromMs, toMs). */
export function responseStats(rows: MsgRow[], fromMs: number, toMs: number) {
  const times = firstResponseTimes(rows.map(toMsg)).filter((t) => t.inboundAtMs >= fromMs && t.inboundAtMs < toMs);
  const byChannel = new Map<string, number[]>();
  for (const t of times) byChannel.set(t.channel, [...(byChannel.get(t.channel) ?? []), t.minutes]);
  return {
    medianMinutes: median(times.map((t) => t.minutes)),
    conversations: times.length,
    byChannel: [...byChannel].map(([channel, mins]) => ({ channel, medianMinutes: median(mins) as number })),
  };
}

/** In and out counts per channel for messages in [fromMs, toMs), busiest first. */
export function countByChannel(rows: MsgRow[], fromMs: number, toMs: number) {
  const out = new Map<string, { channel: string; inbound: number; outbound: number }>();
  for (const r of rows) {
    if (r.atMs < fromMs || r.atMs >= toMs) continue;
    const c = channelOf(r);
    const e = out.get(c) ?? { channel: c, inbound: 0, outbound: 0 };
    e[r.direction] += 1;
    out.set(c, e);
  }
  return [...out.values()].sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound));
}
