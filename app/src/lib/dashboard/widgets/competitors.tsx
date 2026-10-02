import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { formatEur } from "@/lib/utils";
import { mergeRatingSeries, newestReviews, reviewsGained, starsLabel } from "../metrics/competitors";
import {
  activeAds,
  newAdCount,
  recentActivity,
  researchSpend,
  reviewGapData,
  trackedReviews,
  trendHistories,
} from "../metrics/competitorsQueries";
import { truncateText } from "../metrics/content";
import { deltaPct } from "../range";
import type { WidgetImpl } from "../types";
import { cached } from "./cache";
import type { CompetitorsKey } from "./keys";

const dublinDate = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" }) : "";
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const eur = (cents: number) => formatEur(cents / 100);

export const COMPETITORS_WIDGETS = {
  "competitors.reviewGap": {
    href: "/marketing/research",
    async load() {
      const g = reviewGapData();
      if (!g.hasSelf) return { value: "Add your own business in Research", sub: "Google reviews" };
      if (g.self === null || g.others === null) return { value: "No review counts yet", sub: "Google reviews" };
      return {
        value: `${g.self} vs ${Math.round(g.others)}`,
        sub: `Google reviews, ${plural(g.competitors, "competitor", "competitors")}`,
        accent: g.self >= g.others,
      };
    },
    render: kpi,
  },
  "competitors.newAds": {
    href: "/marketing/research",
    async load(ctx) {
      const cur = newAdCount(ctx.range.fromMs, ctx.range.toMs);
      const prev = newAdCount(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "competitors.researchSpend": {
    href: "/marketing/research",
    async load(ctx) {
      const s = researchSpend(ctx.tenantId);
      return { value: eur(s.spentCents), sub: `of ${eur(s.capCents)} this month`, accent: s.spentCents >= s.capCents };
    },
    render: kpi,
  },
  "competitors.ratingTrend": {
    href: "/marketing/research",
    async load(ctx) {
      const hs = await cached(ctx, "competitors.trend", () => trendHistories(4, 26));
      const { data, names } = mergeRatingSeries(
        hs.map((h) => ({
          name: h.name,
          points: h.history.flatMap((m) => (m.ratingMilli === null ? [] : [{ capturedAt: m.capturedAt, rating: m.ratingMilli / 1000 }])),
        })),
      );
      return { data, names, selfName: hs.find((h) => h.isSelf)?.name ?? null };
    },
    render: (d: { data: Record<string, string | number>[]; names: string[]; selfName: string | null }) =>
      d.data.length === 0 ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No rating history yet. Ratings are captured weekly.</div>
      ) : (
        <SeriesChart
          data={d.data}
          xKey="label"
          series={d.names.map((name) => ({
            key: name,
            label: name,
            ...(name === d.selfName ? { color: "var(--accent)" } : { color: "var(--text-tertiary)", dashed: true }),
          }))}
        />
      ),
  },
  "competitors.reviewVelocity": {
    href: "/marketing/research",
    async load(ctx) {
      const hs = await cached(ctx, "competitors.velocity", () => trendHistories(20, 52));
      return hs
        .flatMap((h) => {
          const n = reviewsGained(h.history, ctx.range.fromMs, ctx.range.toMs);
          return n === null ? [] : [{ label: h.name, value: Math.max(0, n), display: `+${n}` }];
        })
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    },
    render: (rows: { label: string; value: number; display: string }[]) => (
      <BarListView rows={rows} empty="Not enough review history to compare yet. Counts are captured weekly." />
    ),
  },
  "competitors.recentReviews": {
    href: "/marketing/research",
    async load() {
      return newestReviews(trackedReviews(), 6).map((r) => ({
        id: `${r.competitor}:${r.externalReviewId}`,
        primary: `${r.author} on ${r.competitor}`,
        secondary: truncateText(r.text, 100) || undefined,
        meta: starsLabel(r.ratingMilli),
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No competitor reviews captured yet." />,
  },
  "competitors.activity": {
    href: "/marketing/research",
    async load() {
      return recentActivity(10).map((e) => ({
        id: e.id,
        primary: e.summary,
        secondary: e.competitor ?? undefined,
        meta: dublinDate(e.occurredAt),
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No competitor activity spotted yet." />,
  },
  "competitors.activeAds": {
    href: "/marketing/research",
    async load() {
      return activeAds(8).map((a) => ({
        id: `${a.competitorId}:${a.adId}`,
        primary: a.pageName || a.competitor,
        secondary: truncateText(a.bodies[0] ?? a.linkTitle ?? "", 100) || undefined,
        meta: a.startedAt ? `running since ${dublinDate(a.startedAt)}` : undefined,
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No competitor ads running right now." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<CompetitorsKey, WidgetImpl<any>>;
