/**
 * The history drawer's grouping and labels, and the opening screen's
 * greeting. Days and hours are Irish (Europe/Dublin), whatever the browser's
 * own time zone. Pure.
 */

import type { ConversationSummary } from "@/lib/agents/conversationModel";
import { dublinDay } from "@/lib/cashModel";
import { dublinHour } from "@/lib/remindersModel";

const TZ = "Europe/Dublin";
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });

export type HistoryLabel = "Today" | "Yesterday" | "Earlier";
export type HistoryGroup = { label: HistoryLabel; items: ConversationSummary[] };

/** The calendar day before an ISO date ("2026-03-01" -> "2026-02-28"). */
export function previousDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function groupHistory(items: ConversationSummary[], now: number): HistoryGroup[] {
  const today = dublinDay(now);
  const yesterday = previousDay(today);
  const byLabel: Record<HistoryLabel, ConversationSummary[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const c of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const day = dublinDay(c.updatedAt);
    byLabel[day === today ? "Today" : day === yesterday ? "Yesterday" : "Earlier"].push(c);
  }
  return (["Today", "Yesterday", "Earlier"] as const).filter((l) => byLabel[l].length > 0).map((label) => ({ label, items: byLabel[label] }));
}

export function historyTimeLabel(at: number, now: number): string {
  if (now - at < 60_000) return "now";
  const day = dublinDay(at);
  const today = dublinDay(now);
  if (day === today) return TIME.format(at);
  if (day === previousDay(today)) return WEEKDAY.format(at);
  return DAY_MONTH.format(at);
}

export function filterHistory(items: ConversationSummary[], query: string): ConversationSummary[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((c) => (c.title || "").toLowerCase().includes(q)) : items;
}

export function greetingFor(now: number, firstName: string | null): string {
  const h = dublinHour(now);
  const part = h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${part}, ${firstName}.` : `${part}.`;
}
