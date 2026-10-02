import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { sourceLabel } from "../metrics/marketing";
import { topNWithOther } from "../metrics/sales";
import { pct } from "../metrics/stats";
import { blogSlugFromPath, blogViewRows, groupViews, revisionSourceLabel } from "../metrics/website";
import {
  blogTitlesBySlug,
  formSubmissionsIn,
  openRequestCount,
  pageViewsSeries,
  pageViewsTotal,
  pathViews,
  recentEdits,
  submissionsByForm,
  trafficRows,
  visitorsSeries,
  visitorsTotal,
} from "../metrics/websiteQueries";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { WebsiteKey } from "./keys";

// Each base query runs once per range per request, however many widgets ask.
const rk = (r: { fromMs: number; toMs: number }) => `${r.fromMs}-${r.toMs}`;
const visitorsIn = (ctx: WidgetCtx, r: { fromMs: number; toMs: number }) => cached(ctx, `website.visitors.${rk(r)}`, () => visitorsTotal(r.fromMs, r.toMs));
const submissionsIn = (ctx: WidgetCtx, r: { fromMs: number; toMs: number }) =>
  cached(ctx, `website.submissions.${rk(r)}`, () => formSubmissionsIn(r.fromMs, r.toMs));
const viewsSeriesIn = (ctx: WidgetCtx, r: { fromMs: number; toMs: number }) =>
  cached(ctx, `website.viewsSeries.${rk(r)}`, () => pageViewsSeries(r.fromMs, r.toMs));

export const WEBSITE_WIDGETS = {
  "website.visitors": {
    href: "/cms",
    async load(ctx) {
      const cur = await visitorsIn(ctx, ctx.range);
      const prev = await visitorsIn(ctx, ctx.previous);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev), accent: cur > 0 };
    },
    render: kpi,
  },
  "website.pageViews": {
    href: "/cms",
    async load(ctx) {
      const cur = pageViewsTotal(ctx.range.fromMs, ctx.range.toMs);
      const prev = pageViewsTotal(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "website.submissions": {
    href: "/forms",
    async load(ctx) {
      const cur = await submissionsIn(ctx, ctx.range);
      const prev = await submissionsIn(ctx, ctx.previous);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "website.enquiryRate": {
    href: "/forms",
    async load(ctx) {
      const visitors = await visitorsIn(ctx, ctx.range);
      const rate = pct(await submissionsIn(ctx, ctx.range), visitors);
      if (rate === null) return { value: "No visitors yet", sub: ctx.range.label };
      const prevRate = pct(await submissionsIn(ctx, ctx.previous), await visitorsIn(ctx, ctx.previous));
      return {
        value: `${rate}%`,
        sub: `${ctx.range.label}, submissions per visitor`,
        delta: prevRate === null ? null : deltaPct(rate, prevRate),
        accent: rate > 0,
      };
    },
    render: kpi,
  },
  "website.trafficTrend": {
    href: "/cms",
    async load(ctx) {
      const views = await viewsSeriesIn(ctx, ctx.range);
      const visitors = visitorsSeries(ctx.range.fromMs, ctx.range.toMs);
      return {
        total: views.total,
        data: views.labels.map((label, i) => ({ label, "Page views": views.values[i], Visitors: visitors.values[i] ?? 0 })),
      };
    },
    render: (d: { data: Record<string, string | number>[]; total: number }) =>
      d.total === 0 ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No page views recorded in this period.</div>
      ) : (
        <SeriesChart
          data={d.data}
          xKey="label"
          series={[
            { key: "Page views", label: "Page views" },
            { key: "Visitors", label: "Visitors", dashed: true },
          ]}
        />
      ),
  },
  "website.topPages": {
    href: "/cms",
    async load(ctx) {
      return groupViews(pathViews(ctx.range.fromMs, ctx.range.toMs), 8);
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No page views recorded in this period." />,
  },
  "website.sources": {
    href: "/cms",
    async load(ctx) {
      const counts = new Map<string, number>();
      for (const r of trafficRows(ctx.range.fromMs, ctx.range.toMs)) {
        const k = sourceLabel(r.utm, r.referrer);
        counts.set(k, (counts.get(k) ?? 0) + r.views);
      }
      return topNWithOther([...counts].map(([label, value]) => ({ label, value })), 8);
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No page views recorded in this period." />,
  },
  "website.submissionsByForm": {
    href: "/forms",
    async load(ctx) {
      return submissionsByForm(ctx.range.fromMs, ctx.range.toMs, 8);
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No form submissions in this period." />,
  },
  "website.blogViews": {
    href: "/cms",
    async load(ctx) {
      const raw = pathViews(ctx.range.fromMs, ctx.range.toMs, "%/blog/%");
      const slugs = [...new Set(raw.flatMap((r) => { const s = blogSlugFromPath(r.path); return s ? [s] : []; }))];
      return blogViewRows(raw, blogTitlesBySlug(slugs), 6);
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No blog post views recorded in this period." />,
  },
  "website.recentEdits": {
    href: "/cms",
    async load() {
      return recentEdits(8).map((e) => ({
        id: e.id,
        primary: e.page,
        secondary: revisionSourceLabel(e.source),
        meta: new Date(e.atMs).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" }),
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No page edits recorded yet." />,
  },
  "website.requests": {
    href: "/cms",
    async load() {
      const n = openRequestCount();
      return { value: String(n), sub: n === 0 ? "No open requests" : "Waiting for a decision", accent: n > 0 };
    },
    render: kpi,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<WebsiteKey, WidgetImpl<any>>;
