import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { DonutView } from "@/components/dashboard/views/DonutView";
import { HeatmapView } from "@/components/dashboard/views/HeatmapView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { listConversations } from "@/lib/conversations";
import { categoryLabel, channelLabel, countByChannel, formatDuration, responseStats, triagedPool, truncate, type MsgRow } from "../data/communication";
import { automationCounts, loadMessages, topTags, triageReplyCounts, unreadEmails } from "../data/communicationQueries";
import { bucketIndex, seriesBuckets, weekdayHourGrid } from "../data/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { CommunicationKey } from "./keys";

const DAY = 86_400_000;
const PAIRING_WINDOW = 7 * DAY;

/**
 * One message load shared by every widget in the request: the previous and
 * current ranges plus 7 days either side, so a reply just outside the range
 * still pairs with its inbound message.
 */
const messages = (ctx: WidgetCtx) =>
  cached(ctx, "communication.messages", () =>
    loadMessages(Math.min(ctx.range.fromMs, ctx.previous.fromMs) - PAIRING_WINDOW, ctx.range.toMs + PAIRING_WINDOW),
  );

const inboundIn = (rows: MsgRow[], fromMs: number, toMs: number) =>
  rows.filter((r) => r.direction === "inbound" && r.atMs >= fromMs && r.atMs < toMs);

const num = (n: number) => n.toLocaleString("en-IE");
const Empty = ({ children }: { children: string }) => (
  <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{children}</div>
);

const PRIORITIES = ["high", "normal", "low"] as const;

export const COMMUNICATION_WIDGETS = {
  "communication.unread": {
    href: "/communication",
    async load() {
      const n = unreadEmails();
      return { value: String(n), sub: n === 1 ? "Unread email" : "Unread emails", accent: n > 0 };
    },
    render: kpi,
  },
  "communication.inbound": {
    href: "/communication",
    async load(ctx) {
      const rows = await messages(ctx);
      const cur = inboundIn(rows, ctx.range.fromMs, ctx.range.toMs).length;
      const prev = inboundIn(rows, ctx.previous.fromMs, ctx.previous.toMs).length;
      return { value: num(cur), sub: `Messages received, ${ctx.range.label}`, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "communication.firstResponse": {
    href: "/communication",
    async load(ctx) {
      const rows = await messages(ctx);
      const cur = responseStats(rows, ctx.range.fromMs, ctx.range.toMs);
      const prev = responseStats(rows, ctx.previous.fromMs, ctx.previous.toMs);
      if (cur.medianMinutes === null) return { value: "No data", sub: "No answered conversations in this period" };
      return {
        value: formatDuration(cur.medianMinutes),
        sub: `median, ${cur.conversations} ${cur.conversations === 1 ? "conversation" : "conversations"}`,
        delta: prev.medianMinutes === null ? null : deltaPct(cur.medianMinutes, prev.medianMinutes),
      };
    },
    render: kpi,
  },
  "communication.autoReplyRate": {
    href: "/communication",
    async load(ctx) {
      const cur = triageReplyCounts(ctx.range.fromMs, ctx.range.toMs);
      const prev = triageReplyCounts(ctx.previous.fromMs, ctx.previous.toMs);
      if (cur.triaged === 0) return { value: "No data", sub: "No triaged messages in this period" };
      const rate = Math.round((cur.autoSent / cur.triaged) * 100);
      const prevRate = prev.triaged === 0 ? null : Math.round((prev.autoSent / prev.triaged) * 100);
      return {
        value: `${rate}%`,
        sub: `${cur.forReview} drafted for review`,
        delta: prevRate === null ? null : deltaPct(rate, prevRate),
      };
    },
    render: kpi,
  },
  "communication.byChannel": {
    href: "/communication",
    async load(ctx) {
      const rows = await messages(ctx);
      return countByChannel(rows, ctx.range.fromMs, ctx.range.toMs).map((c) => ({
        label: channelLabel(c.channel),
        value: c.inbound + c.outbound,
        display: `${num(c.inbound)} / ${num(c.outbound)}`,
        sub: "in / out",
      }));
    },
    render: (rows: { label: string; value: number; display: string; sub: string }[]) => (
      <BarListView rows={rows} empty="No messages in this period." />
    ),
  },
  "communication.inOutTrend": {
    href: "/communication",
    async load(ctx) {
      const rows = await messages(ctx);
      const buckets = seriesBuckets(ctx.range.fromMs, ctx.range.toMs);
      const out = buckets.map((b) => ({ label: b.label, Inbound: 0, Outbound: 0 }));
      for (const r of rows) {
        const i = bucketIndex(buckets, r.atMs);
        if (i < 0) continue;
        if (r.direction === "inbound") out[i].Inbound += 1;
        else out[i].Outbound += 1;
      }
      return out;
    },
    render: (data: Record<string, string | number>[]) =>
      data.every((r) => r.Inbound === 0 && r.Outbound === 0) ? (
        <Empty>No messages in this period.</Empty>
      ) : (
        <SeriesChart
          data={data}
          xKey="label"
          series={[
            { key: "Inbound", label: "Inbound" },
            { key: "Outbound", label: "Outbound", color: "var(--text-tertiary)" },
          ]}
        />
      ),
  },
  "communication.responseByChannel": {
    href: "/communication",
    async load(ctx) {
      const rows = await messages(ctx);
      return responseStats(rows, ctx.range.fromMs, ctx.range.toMs)
        .byChannel.sort((a, b) => a.medianMinutes - b.medianMinutes)
        .map((c) => ({ label: channelLabel(c.channel), value: c.medianMinutes, display: formatDuration(c.medianMinutes) }));
    },
    render: (rows: { label: string; value: number; display: string }[]) => (
      <BarListView rows={rows} empty="No answered conversations in this period." />
    ),
  },
  "communication.triageCategories": {
    href: "/communication",
    async load(ctx) {
      const counts = new Map<string, number>();
      for (const r of triagedPool(await messages(ctx), ctx.range.fromMs, ctx.range.toMs)) {
        const label = categoryLabel(r.aiCategory);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    },
    render: (data: { label: string; value: number }[]) => <DonutView data={data} empty="No messages in this period." />,
  },
  "communication.priorityMix": {
    href: "/communication",
    async load(ctx) {
      const c = { high: 0, normal: 0, low: 0 };
      for (const r of triagedPool(await messages(ctx), ctx.range.fromMs, ctx.range.toMs)) {
        if ((PRIORITIES as readonly string[]).includes(r.aiPriority ?? "")) c[r.aiPriority as (typeof PRIORITIES)[number]] += 1;
      }
      return {
        value: String(c.high),
        sub: `high priority, ${c.normal} normal, ${c.low} low`,
        accent: c.high > 0,
      };
    },
    render: kpi,
  },
  "communication.busiestHours": {
    href: "/communication",
    async load(ctx) {
      const times = inboundIn(await messages(ctx), ctx.range.fromMs, ctx.range.toMs).map((r) => r.atMs);
      return weekdayHourGrid(times, "Europe/Dublin");
    },
    render: (grid: number[][]) => <HeatmapView grid={grid} empty="No messages in this period." />,
  },
  "communication.awaitingReply": {
    href: "/communication",
    async load(ctx) {
      const now = Date.now();
      const all = await cached(ctx, "communication.conversations", () => listConversations());
      return all
        .filter((c) => c.lastDirection === "inbound")
        .sort((a, b) => a.lastAt.getTime() - b.lastAt.getTime())
        .slice(0, 10)
        .map((c) => ({
          id: `${c.kind}:${c.contactId}`,
          primary: c.name,
          secondary: [channelLabel(c.channel ?? "other"), c.aiSummary ? truncate(c.aiSummary, 80) : null].filter(Boolean).join(" - "),
          meta: `waiting ${formatDuration(Math.max(0, now - c.lastAt.getTime()) / 60_000)}`,
          href: c.href,
        }));
    },
    render: (rows: { id: string; primary: string; secondary: string; meta: string; href: string }[]) => (
      <RowList rows={rows} empty="Nothing is waiting for a reply." />
    ),
  },
  "communication.topTags": {
    href: "/communication",
    async load(ctx) {
      return topTags(ctx.range.fromMs, ctx.range.toMs, 8);
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No tags added in this period." />,
  },
  "communication.automations": {
    href: "/automations",
    async load(ctx) {
      const c = automationCounts(ctx.range.fromMs, ctx.range.toMs);
      return [
        { label: "Sent", value: c.sent },
        { label: "Failed", value: c.failed },
        { label: "Still queued", value: c.queued },
      ];
    },
    render: (rows: { label: string; value: number }[]) =>
      rows.every((r) => r.value === 0) ? <Empty>No automated messages in this period.</Empty> : <BarListView rows={rows} empty="" />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<CommunicationKey, WidgetImpl<any>>;
