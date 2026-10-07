import "server-only";

import { AlertTriangle, Star } from "lucide-react";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { StatList } from "@/components/dashboard/views/StatList";
import { TableView } from "@/components/dashboard/views/TableView";
import { WidgetEmpty } from "@/components/dashboard/views/WidgetEmpty";
import {
  GoogleApiError,
  getAnalyticsChannels,
  getAnalyticsDaily,
  getProfileSeries,
  getReviewSummary,
  getSearchConsoleRows,
  getSearchKeywords,
  listStoredReviews,
} from "@/lib/google/business";
import { profileTotals, viewsByDay, type DailySeries } from "@/lib/google/businessApi";
import { relativeTime } from "@/lib/utils";
import { bucketIndex, seriesBuckets } from "../metrics/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { GoogleKey } from "./keys";

/**
 * Google widgets: Business Profile numbers (live from Google, cached 15 min
 * in lib/google/business), reviews (from the synced copy), Search Console and
 * Analytics. Every load is fail-soft: until Google approves the app's access
 * the API refuses, and the tile says why instead of breaking the grid.
 */

const SETTINGS = "/settings/integrations/google";
const n = (v: number) => v.toLocaleString("en-IE");

type Safe<T> = { ok: true; data: T } | { ok: false; error: string };
async function safe<T>(fn: () => Promise<T>): Promise<Safe<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof GoogleApiError ? err.message : "Google did not answer. It will try again shortly." };
  }
}
const failed = (error: string) => <WidgetEmpty text={error} icon={AlertTriangle} action={{ href: SETTINGS, label: "Google settings" }} />;

const series = (ctx: WidgetCtx, prev = false) => {
  const r = prev ? ctx.previous : ctx.range;
  return cached(ctx, `google.series:${r.fromMs}:${r.toMs}`, () => safe(() => getProfileSeries(ctx.tenantId, r.fromMs, r.toMs)));
};

/** Daily values summed into the dashboard's buckets (days up to a month, then weeks). */
function bucketed(ctx: WidgetCtx, days: { day: string; values: number[] }[], width: number) {
  const buckets = seriesBuckets(ctx.range.fromMs, ctx.range.toMs);
  const sums = buckets.map(() => new Array<number>(width).fill(0));
  for (const d of days) {
    const i = bucketIndex(buckets, Date.parse(`${d.day}T12:00:00Z`));
    if (i >= 0) d.values.forEach((v, k) => (sums[i][k] += v));
  }
  return buckets.map((b, i) => ({ label: b.label, values: sums[i] }));
}

function profileKpi(pick: (t: ReturnType<typeof profileTotals>) => number, sub: string, spark?: (s: DailySeries, ctx: WidgetCtx) => number[]) {
  return {
    href: SETTINGS,
    async load(ctx: WidgetCtx) {
      const [cur, prev] = await Promise.all([series(ctx), series(ctx, true)]);
      if (!cur.ok) return { error: cur.error };
      const v = pick(profileTotals(cur.data));
      const p = prev.ok ? pick(profileTotals(prev.data)) : null;
      return {
        value: n(v),
        sub: `${sub}, ${ctx.range.label.toLowerCase()}`,
        delta: p === null ? null : deltaPct(v, p),
        accent: v > 0,
        spark: spark ? spark(cur.data, ctx) : undefined,
      };
    },
    render: (d: { error: string } | Parameters<typeof kpi>[0]) => ("error" in d ? failed(d.error) : kpi(d)),
  };
}

const viewsSpark = (s: DailySeries, ctx: WidgetCtx) =>
  bucketed(ctx, viewsByDay(s, ctx.range.fromMs, ctx.range.days).map((d) => ({ day: d.day, values: [d.search + d.maps] })), 1).map((b) => b.values[0]);

export const GOOGLE_WIDGETS = {
  "google.profileViews": profileKpi((t) => t.views, "Search and Maps", viewsSpark),
  "google.calls": profileKpi((t) => t.calls, "Calls from your listing"),
  "google.websiteClicks": profileKpi((t) => t.websiteClicks, "Website clicks"),
  "google.directions": profileKpi((t) => t.directions, "Direction requests"),

  "google.actions": {
    href: SETTINGS,
    async load(ctx) {
      const cur = await series(ctx);
      if (!cur.ok) return { error: cur.error };
      const t = profileTotals(cur.data);
      return {
        rows: [
          { label: "Calls", sub: ctx.range.label, value: n(t.calls) },
          { label: "Website clicks", sub: ctx.range.label, value: n(t.websiteClicks) },
          { label: "Direction requests", sub: ctx.range.label, value: n(t.directions) },
          { label: "Messages and bookings", sub: ctx.range.label, value: n(t.messages + t.bookings) },
        ],
      };
    },
    render: (d: { error: string } | { rows: { label: string; sub: string; value: string }[] }) => ("error" in d ? failed(d.error) : <StatList rows={d.rows} />),
  },

  "google.viewsTrend": {
    href: SETTINGS,
    async load(ctx) {
      const cur = await series(ctx);
      if (!cur.ok) return { error: cur.error };
      const daily = viewsByDay(cur.data, ctx.range.fromMs, ctx.range.days).map((d) => ({ day: d.day, values: [d.search, d.maps] }));
      return { data: bucketed(ctx, daily, 2).map((b) => ({ label: b.label, Search: b.values[0], Maps: b.values[1] })) };
    },
    render: (d: { error: string } | { data: Record<string, string | number>[] }) =>
      "error" in d ? (
        failed(d.error)
      ) : (
        <SeriesChart data={d.data} xKey="label" series={[{ key: "Search", label: "Google Search" }, { key: "Maps", label: "Google Maps", dashed: true }]} />
      ),
  },

  "google.searchTerms": {
    href: SETTINGS,
    async load(ctx) {
      const r = await cached(ctx, "google.keywords", () => safe(() => getSearchKeywords(ctx.tenantId)));
      if (!r.ok) return { error: r.error };
      return {
        month: r.data.month,
        rows: r.data.rows.slice(0, 10).map((k) => ({ label: k.keyword, value: k.count, display: k.under ? `under ${k.count}` : n(k.count) })),
      };
    },
    render: (d: { error: string } | { month: string; rows: { label: string; value: number; display: string }[] }) =>
      "error" in d ? (
        failed(d.error)
      ) : (
        <>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 10 }}>{d.month}</div>
          <BarListView rows={d.rows} empty="Google has not reported search terms for last month." />
        </>
      ),
  },

  "google.rating": {
    href: "/communication?view=google",
    async load(ctx) {
      const s = getReviewSummary(ctx.tenantId);
      if (!s || s.average == null) return { value: "No reviews yet", sub: "Google rating" };
      return { value: s.average.toFixed(1), sub: `${n(s.total ?? 0)} reviews on Google`, accent: true };
    },
    render: kpi,
  },

  "google.reviewsToAnswer": {
    href: "/communication",
    async load(ctx) {
      const open = listStoredReviews(ctx.tenantId).filter((r) => !r.reply).length;
      return { value: String(open), sub: open === 1 ? "Review without a reply" : "Reviews without a reply", accent: open > 0 };
    },
    render: kpi,
  },

  "google.recentReviews": {
    href: "/communication",
    async load(ctx) {
      return listStoredReviews(ctx.tenantId, 6).map((r) => ({
        id: r.id,
        primary: `${r.reviewer}, ${r.rating} out of 5`,
        secondary: r.comment ? (r.comment.length > 90 ? `${r.comment.slice(0, 89)}…` : r.comment) : "Rating only",
        meta: relativeTime(r.updatedAt),
        href: `/communication?open=review:${r.id}`,
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No Google reviews pulled in yet." emptyIcon={Star} />,
  },

  "google.searchClicks": {
    href: SETTINGS,
    async load(ctx) {
      const [cur, prev] = await Promise.all([
        cached(ctx, `google.sc.date:${ctx.range.fromMs}`, () => safe(() => getSearchConsoleRows(ctx.tenantId, ctx.range.fromMs, ctx.range.toMs, "date", 400))),
        cached(ctx, `google.sc.date:${ctx.previous.fromMs}`, () => safe(() => getSearchConsoleRows(ctx.tenantId, ctx.previous.fromMs, ctx.previous.toMs, "date", 400))),
      ]);
      if (!cur.ok) return { error: cur.error };
      const clicks = cur.data.reduce((a, r) => a + r.clicks, 0);
      const prevClicks = prev.ok ? prev.data.reduce((a, r) => a + r.clicks, 0) : null;
      const spark = bucketed(ctx, cur.data.map((r) => ({ day: r.key, values: [r.clicks] })), 1).map((b) => b.values[0]);
      return { value: n(clicks), sub: `From Google Search, ${ctx.range.label.toLowerCase()}`, delta: prevClicks === null ? null : deltaPct(clicks, prevClicks), accent: clicks > 0, spark };
    },
    render: (d: { error: string } | Parameters<typeof kpi>[0]) => ("error" in d ? failed(d.error) : kpi(d)),
  },

  "google.searchQueries": {
    href: SETTINGS,
    async load(ctx) {
      const r = await cached(ctx, `google.sc.query:${ctx.range.fromMs}`, () => safe(() => getSearchConsoleRows(ctx.tenantId, ctx.range.fromMs, ctx.range.toMs, "query", 10)));
      if (!r.ok) return { error: r.error };
      return {
        rows: r.data.map((q) => ({ query: q.key, clicks: n(q.clicks), impressions: n(q.impressions), position: q.position ? q.position.toFixed(1) : "-" })),
      };
    },
    render: (d: { error: string } | { rows: Record<string, string>[] }) =>
      "error" in d ? (
        failed(d.error)
      ) : (
        <TableView
          columns={[
            { key: "query", label: "Search" },
            { key: "clicks", label: "Clicks", align: "right" },
            { key: "impressions", label: "Seen", align: "right" },
            { key: "position", label: "Position", align: "right" },
          ]}
          rows={d.rows}
          empty="No Google searches led to the site in this period."
        />
      ),
  },

  "google.siteSessions": {
    href: SETTINGS,
    async load(ctx) {
      const [cur, prev] = await Promise.all([
        cached(ctx, `google.ga:${ctx.range.fromMs}`, () => safe(() => getAnalyticsDaily(ctx.tenantId, ctx.range.fromMs, ctx.range.toMs))),
        cached(ctx, `google.ga:${ctx.previous.fromMs}`, () => safe(() => getAnalyticsDaily(ctx.tenantId, ctx.previous.fromMs, ctx.previous.toMs))),
      ]);
      if (!cur.ok) return { error: cur.error };
      const total = cur.data.reduce((a, r) => a + r.sessions, 0);
      const prevTotal = prev.ok ? prev.data.reduce((a, r) => a + r.sessions, 0) : null;
      const spark = bucketed(ctx, cur.data.map((r) => ({ day: r.day, values: [r.sessions] })), 1).map((b) => b.values[0]);
      return { value: n(total), sub: `Website visits, ${ctx.range.label.toLowerCase()}`, delta: prevTotal === null ? null : deltaPct(total, prevTotal), accent: total > 0, spark };
    },
    render: (d: { error: string } | Parameters<typeof kpi>[0]) => ("error" in d ? failed(d.error) : kpi(d)),
  },

  "google.siteTrend": {
    href: SETTINGS,
    async load(ctx) {
      const cur = await cached(ctx, `google.ga:${ctx.range.fromMs}`, () => safe(() => getAnalyticsDaily(ctx.tenantId, ctx.range.fromMs, ctx.range.toMs)));
      if (!cur.ok) return { error: cur.error };
      return {
        data: bucketed(ctx, cur.data.map((r) => ({ day: r.day, values: [r.sessions, r.users] })), 2).map((b) => ({ label: b.label, Visits: b.values[0], People: b.values[1] })),
      };
    },
    render: (d: { error: string } | { data: Record<string, string | number>[] }) =>
      "error" in d ? (
        failed(d.error)
      ) : (
        <SeriesChart data={d.data} xKey="label" series={[{ key: "Visits", label: "Visits" }, { key: "People", label: "People", dashed: true }]} />
      ),
  },

  "google.siteChannels": {
    href: SETTINGS,
    async load(ctx) {
      const r = await cached(ctx, `google.gac:${ctx.range.fromMs}`, () => safe(() => getAnalyticsChannels(ctx.tenantId, ctx.range.fromMs, ctx.range.toMs)));
      if (!r.ok) return { error: r.error };
      return { rows: r.data.map((c) => ({ label: c.channel, value: c.sessions, display: n(c.sessions) })) };
    },
    render: (d: { error: string } | { rows: { label: string; value: number; display: string }[] }) =>
      "error" in d ? failed(d.error) : <BarListView rows={d.rows} empty="No visits recorded in this period." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<GoogleKey, WidgetImpl<any>>;

