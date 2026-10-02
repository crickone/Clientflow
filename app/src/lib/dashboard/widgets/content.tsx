import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { channelCounts, channelsLabel, generationLabel, truncateText } from "../metrics/content";
import {
  blogPipelineCounts,
  blogPublishedCount,
  calendarItems,
  failedCount,
  failedPosts,
  libraryCounts,
  postedChannelColumns,
  postedCount,
  recentDesigns,
  scheduledCount,
} from "../metrics/contentQueries";
import { deltaPct } from "../range";
import type { WidgetImpl } from "../types";
import type { ContentKey } from "./keys";

const dublin = (ms: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(ms).toLocaleString("en-IE", { ...opts, timeZone: "Europe/Dublin" });
const dateTime = (ms: number) => dublin(ms, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const CONTENT_WIDGETS = {
  "content.published": {
    href: "/content-studio",
    async load(ctx) {
      const cur = postedCount(ctx.range.fromMs, ctx.range.toMs);
      const prev = postedCount(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev), accent: cur > 0 };
    },
    render: kpi,
  },
  "content.scheduled": {
    href: "/content-studio",
    async load(ctx) {
      const n = scheduledCount(ctx.now.getTime());
      return { value: String(n), sub: n === 0 ? "Nothing waiting to go out" : "Waiting to go out" };
    },
    render: kpi,
  },
  "content.failed": {
    href: "/content-studio",
    async load(ctx) {
      const cur = failedCount(ctx.range.fromMs, ctx.range.toMs);
      const prev = failedCount(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev), goodWhen: "down" as const, accent: cur > 0 };
    },
    render: kpi,
  },
  "content.blogPublished": {
    href: "/content-studio",
    async load(ctx) {
      const cur = blogPublishedCount(ctx.range.fromMs, ctx.range.toMs);
      const prev = blogPublishedCount(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "content.calendar": {
    href: "/content-studio",
    async load(ctx) {
      return calendarItems(ctx.now.getTime(), 14, 12).map((x, i) => ({
        id: `${x.kind}:${i}`,
        primary: x.name,
        secondary: x.kind === "post" ? `Social post, ${channelsLabel(x.channels)}` : "Blog post",
        meta: dateTime(x.atMs),
      }));
    },
    render: (rows) => <RowList rows={rows} empty="Nothing scheduled in the next 14 days." />,
  },
  "content.byPlatform": {
    href: "/content-studio",
    async load(ctx) {
      return channelCounts(postedChannelColumns(ctx.range.fromMs, ctx.range.toMs));
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No posts went out in this period." />,
  },
  "content.failedList": {
    href: "/content-studio",
    async load() {
      return failedPosts(8).map((p) => ({
        id: p.id,
        primary: p.name,
        secondary: p.error ? truncateText(p.error, 90) : "No reason recorded",
        meta: dateTime(p.atMs),
        href: "/content-studio",
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No failed posts." />,
  },
  "content.recentDesigns": {
    href: "/content-studio",
    async load() {
      return recentDesigns(8).map((x) => ({
        id: x.id,
        primary: x.name,
        secondary: `${plural(x.slides, "slide", "slides")}, ${generationLabel(x.status)}`,
        meta: dublin(x.updatedAtMs, { day: "numeric", month: "short" }),
        href: "/content-studio",
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No designs yet. Create one in Content Studio." />,
  },
  "content.library": {
    href: "/content-studio",
    async load(ctx) {
      const c = libraryCounts(ctx.range.fromMs, ctx.range.toMs);
      return { value: String(c.total), sub: `+${c.added} this period`, accent: c.added > 0 };
    },
    render: kpi,
  },
  "content.blogPipeline": {
    href: "/content-studio",
    async load() {
      const p = blogPipelineCounts();
      return [
        { label: "Drafts", value: p.drafts },
        { label: "Scheduled", value: p.scheduled },
        { label: "Published", value: p.published },
      ];
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No blog posts yet." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<ContentKey, WidgetImpl<any>>;
