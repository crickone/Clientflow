import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { TableView } from "@/components/dashboard/views/TableView";
import { formatEur } from "@/lib/utils";
import { blendedTotals, cacCents, roasRatio, sourceLabel } from "../data/marketing";
import {
  campaignLeadCountsIn,
  campaignsByStatus,
  countCampaignLeadsIn,
  formSubmissionsIn,
  landingViewsIn,
  ratingGap,
  scoredCampaigns,
  seasonalDates,
  trafficRows,
  upcomingSendItems,
  visitorsSeries,
} from "../data/marketingQueries";
import { topNWithOther } from "../data/sales";
import { pct } from "../data/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { MarketingKey } from "./keys";

const scores = (ctx: WidgetCtx) => cached(ctx, "marketing.scoreboards", () => scoredCampaigns());

const eur = (cents: number) => formatEur(cents / 100);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const MARKETING_WIDGETS = {
  "marketing.activeCampaigns": {
    href: "/marketing/campaigns",
    async load() {
      const { active, ready } = campaignsByStatus();
      return { value: String(active), sub: `${ready} ready to launch`, accent: active > 0 };
    },
    render: kpi,
  },
  "marketing.campaignLeads": {
    href: "/leads",
    async load(ctx) {
      const cur = countCampaignLeadsIn(ctx.range.fromMs, ctx.range.toMs);
      const prev = countCampaignLeadsIn(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "marketing.blendedCac": {
    href: "/marketing/campaigns",
    async load(ctx) {
      const t = blendedTotals((await scores(ctx)).map((x) => x.score));
      const sub = `All time, ${plural(t.campaigns, "campaign", "campaigns")} with ad spend`;
      const cac = cacCents(t.spendCents, t.converts);
      return cac === null ? { value: "No customers yet", sub } : { value: eur(cac), sub };
    },
    render: kpi,
  },
  "marketing.roas": {
    href: "/marketing/campaigns",
    async load(ctx) {
      const t = blendedTotals((await scores(ctx)).map((x) => x.score));
      const r = roasRatio(t.revenueCents, t.spendCents);
      return r === null
        ? { value: "No ad spend recorded", sub: "All time" }
        : { value: `${r}x`, sub: `All time, ${eur(t.revenueCents)} from ${eur(t.spendCents)} spent` };
    },
    render: kpi,
  },
  "marketing.scoreboard": {
    href: "/marketing/campaigns",
    async load(ctx) {
      return (await scores(ctx)).map(({ campaign: c, score: s }) => ({
        id: c.id,
        Campaign: c.name,
        Status: c.status === "active" ? "Active" : "Complete",
        Leads: s.leads,
        Customers: s.converts,
        Conversion: s.conversionRatePct === null ? null : `${Math.round(s.conversionRatePct * 10) / 10}%`,
        "Cost per customer": s.cacCents === null ? null : eur(s.cacCents),
        ROAS: (r => (r === null ? null : `${r}x`))(roasRatio(s.upfrontCashCents + s.mrrCents, s.adSpendCents)),
      }));
    },
    render: (rows: Record<string, string | number | null>[]) => (
      <div>
        <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginBottom: 6 }}>All time</div>
        <TableView
          columns={[
            { key: "Campaign", label: "Campaign" },
            { key: "Status", label: "Status" },
            { key: "Leads", label: "Leads", align: "right" },
            { key: "Customers", label: "Customers", align: "right" },
            { key: "Conversion", label: "Conversion", align: "right" },
            { key: "Cost per customer", label: "Cost per customer", align: "right" },
            { key: "ROAS", label: "ROAS", align: "right" },
          ]}
          rows={rows}
          empty="No active or completed campaigns yet."
        />
      </div>
    ),
  },
  "marketing.landingFunnel": {
    href: "/marketing/campaigns",
    async load(ctx) {
      const set = await scores(ctx);
      const leads = campaignLeadCountsIn(ctx.range.fromMs, ctx.range.toMs);
      return set.map(({ campaign: c }) => {
        const views = landingViewsIn(c.slug, ctx.range.fromMs, ctx.range.toMs);
        const l = leads.get(c.name) ?? 0;
        const rate = pct(l, views);
        return { id: c.id, Campaign: c.name, Views: views, Leads: l, "View to lead": rate === null ? null : `${rate}%` };
      });
    },
    render: (rows: Record<string, string | number | null>[]) => (
      <TableView
        columns={[
          { key: "Campaign", label: "Campaign" },
          { key: "Views", label: "Views", align: "right" },
          { key: "Leads", label: "Leads", align: "right" },
          { key: "View to lead", label: "View to lead %", align: "right" },
        ]}
        rows={rows}
        empty="No active or completed campaigns yet."
      />
    ),
  },
  "marketing.visitorsTrend": {
    href: "/cms",
    async load(ctx) {
      const cur = visitorsSeries(ctx.range.fromMs, ctx.range.toMs);
      const prev = visitorsSeries(ctx.previous.fromMs, ctx.previous.toMs);
      const data = cur.labels.map((label, i) => ({ label, Visitors: cur.values[i], Previous: prev.values[i] ?? 0 }));
      return { data, total: cur.total, delta: deltaPct(cur.total, prev.total) };
    },
    render: (d: { data: Record<string, string | number>[]; total: number; delta: number | null }) => {
      const deltaText = d.delta === null ? "" : ` (${d.delta > 0 ? "+" : ""}${d.delta}% vs previous period)`;
      return d.total === 0 && d.data.every((r) => r.Previous === 0) ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No website visitors recorded in this period.</div>
      ) : (
        <div>
          <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 6 }}>
            {plural(d.total, "unique visitor", "unique visitors")}
            {deltaText}
          </div>
          <SeriesChart
            data={d.data}
            xKey="label"
            series={[
              { key: "Visitors", label: "Visitors" },
              { key: "Previous", label: "Previous period", dashed: true },
            ]}
          />
        </div>
      );
    },
  },
  "marketing.trafficSources": {
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
  "marketing.formSubmissions": {
    href: "/forms",
    async load(ctx) {
      const cur = formSubmissionsIn(ctx.range.fromMs, ctx.range.toMs);
      const prev = formSubmissionsIn(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "marketing.upcomingSends": {
    href: "/content-studio",
    async load(ctx) {
      return upcomingSendItems(ctx.now.getTime(), 14, 8).map((x, i) => ({
        id: `${x.kind}:${i}`,
        primary: x.name,
        secondary: x.kind === "post" ? "Social post" : "Email",
        meta: new Date(x.atMs).toLocaleString("en-IE", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Dublin",
        }),
      }));
    },
    render: (rows) => <RowList rows={rows} empty="Nothing scheduled in the next 14 days." />,
  },
  "marketing.seasonalDates": {
    href: "/marketing",
    async load(ctx) {
      return seasonalDates(ctx.now, 6).map((x) => ({
        id: x.id,
        primary: x.name,
        secondary: x.angle,
        meta: x.inDays <= 0 ? "today" : x.inDays === 1 ? "tomorrow" : `in ${x.inDays} days`,
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No seasonal dates in the next 60 days." />,
  },
  "marketing.ratingGap": {
    href: "/marketing/research",
    async load() {
      const g = ratingGap();
      if (!g.hasSelf) return { value: "Add your own business in Research", sub: "Google rating" };
      if (g.self === null || g.others === null) return { value: "No ratings yet", sub: "Google rating" };
      return {
        value: `${g.self.toFixed(1)} vs ${g.others.toFixed(1)}`,
        sub: `Google rating, ${plural(g.competitors, "competitor", "competitors")}`,
        accent: g.self >= g.others,
      };
    },
    render: kpi,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<MarketingKey, WidgetImpl<any>>;
