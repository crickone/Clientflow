import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { FunnelView } from "@/components/dashboard/views/FunnelView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { conversionByGroup, singular, topNWithOther } from "../metrics/sales";
import {
  avgTimeInStageDays,
  conversionIn,
  countLeadsIn,
  funnelSteps,
  isWon,
  leadsCreatedIn,
  medianLeadToWonDays,
  openPipelineCount,
  slaBreachCount,
  stageDistribution,
  staleLeads,
  wonLeadsIn,
  wonLostSeries,
} from "../metrics/salesQueries";
import { pct } from "../metrics/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { SalesKey } from "./keys";

const created = (ctx: WidgetCtx) =>
  cached(ctx, "sales.leadsCreated", () => leadsCreatedIn(ctx.range.fromMs, ctx.range.toMs));

const conversionRows = (rows: { group: string | null; role: string | null }[]) =>
  conversionByGroup(rows.map((r) => ({ group: r.group, won: isWon(r.role) })));

const conversionRender = (rows: ReturnType<typeof conversionByGroup>) => (
  <BarListView
    rows={rows.map((r) => ({ label: r.label, value: r.pct, display: `${r.pct}% (${r.won}/${r.total})` }))}
    max={100}
    empty="Not enough leads in this period yet (a group needs at least 3)."
  />
);

const DAY = 86_400_000;

export const SALES_WIDGETS = {
  "sales.newLeads": {
    href: "/leads",
    async load(ctx) {
      const cur = countLeadsIn(ctx.range.fromMs, ctx.range.toMs);
      const prev = countLeadsIn(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev), accent: cur > 0 };
    },
    render: kpi,
  },
  "sales.conversionRate": {
    href: "/leads",
    async load(ctx) {
      const rows = await created(ctx);
      const cur = { total: rows.length, won: rows.filter((r) => isWon(r.role)).length };
      const prev = conversionIn(ctx.previous.fromMs, ctx.previous.toMs);
      const p = pct(cur.won, cur.total);
      const pp = pct(prev.won, prev.total);
      return {
        value: p === null ? "No leads" : `${p}%`,
        sub: `${cur.won} of ${cur.total} leads`,
        delta: p !== null && pp !== null ? deltaPct(p, pp) : null,
      };
    },
    render: kpi,
  },
  "sales.wonThisPeriod": {
    href: "/leads",
    async load(ctx) {
      const cur = wonLeadsIn(ctx.range.fromMs, ctx.range.toMs);
      const prev = wonLeadsIn(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev) };
    },
    render: kpi,
  },
  "sales.openPipeline": {
    href: "/leads",
    async load() {
      const { open, pipelines } = openPipelineCount();
      return { value: String(open), sub: `across ${pipelines} ${pipelines === 1 ? "pipeline" : "pipelines"}` };
    },
    render: kpi,
  },
  "sales.funnel": {
    href: "/leads",
    async load(ctx) {
      return funnelSteps(ctx.range.fromMs, ctx.range.toMs);
    },
    render: (steps) => <FunnelView steps={steps} empty="No stage moves recorded in this period." />,
  },
  "sales.stageDistribution": {
    href: "/leads",
    async load() {
      return stageDistribution();
    },
    render: (rows: Awaited<ReturnType<typeof stageDistribution>>) => {
      const total = rows.reduce((s, r) => s + r.value, 0);
      return (
        <BarListView
          rows={rows.map((r) => ({ ...r, display: `${r.value} (${Math.round(pct(r.value, total) ?? 0)}%)` }))}
          empty="No leads in the pipeline yet."
        />
      );
    },
  },
  "sales.timeInStage": {
    href: "/leads",
    async load(ctx) {
      return avgTimeInStageDays(ctx.range.fromMs, ctx.range.toMs);
    },
    render: (rows: Awaited<ReturnType<typeof avgTimeInStageDays>>) => (
      <BarListView
        rows={rows.map((r) => ({
          label: r.label,
          value: r.value,
          display: `${r.value} ${r.value === 1 ? "day" : "days"}`,
          sub: `${r.stays} ${r.stays === 1 ? "stay" : "stays"}`,
        }))}
        empty="No completed stays in this period."
      />
    ),
  },
  "sales.leadsBySource": {
    href: "/leads",
    async load(ctx) {
      const counts = new Map<string, number>();
      for (const l of await created(ctx)) counts.set(l.source, (counts.get(l.source) ?? 0) + 1);
      return topNWithOther([...counts].map(([label, value]) => ({ label, value })), 8);
    },
    render: (rows) => <BarListView rows={rows} empty="No leads in this period." />,
  },
  "sales.conversionBySource": {
    href: "/leads",
    async load(ctx) {
      return conversionRows((await created(ctx)).map((l) => ({ group: l.source, role: l.role })));
    },
    render: conversionRender,
  },
  "sales.conversionByService": {
    label: (ctx) => `Conversion by ${singular(ctx.vocab.services)}`,
    href: "/leads",
    async load(ctx) {
      return conversionRows((await created(ctx)).map((l) => ({ group: l.therapyInterest, role: l.role })));
    },
    render: conversionRender,
  },
  "sales.staleLeads": {
    href: "/leads",
    async load(ctx) {
      return staleLeads(ctx.now.getTime(), 10).map((l) => ({
        id: l.id,
        primary: [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || `Lead ${l.id}`,
        secondary: l.stage ?? "No stage",
        meta: `${Math.floor((ctx.now.getTime() - l.updatedAt.getTime()) / DAY)} days`,
        href: "/leads",
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No stale leads. Everything has moved in the last 7 days." />,
  },
  "sales.velocity": {
    href: "/leads",
    async load(ctx) {
      const m = medianLeadToWonDays(ctx.range.fromMs, ctx.range.toMs);
      return m === null
        ? { value: "No wins yet", sub: "median, lead to won" }
        : { value: `${m} ${m === 1 ? "day" : "days"}`, sub: "median, lead to won" };
    },
    render: kpi,
  },
  "sales.wonLostTrend": {
    href: "/leads",
    async load(ctx) {
      return wonLostSeries(ctx.range.fromMs, ctx.range.toMs);
    },
    render: (data: Awaited<ReturnType<typeof wonLostSeries>>) =>
      data.every((r) => r.Won === 0 && r.Lost === 0) ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No leads won or lost in this period.</div>
      ) : (
        <SeriesChart
          data={data}
          xKey="label"
          kind="bar"
          series={[
            { key: "Won", label: "Won" },
            { key: "Lost", label: "Lost" },
          ]}
        />
      ),
  },
  "sales.leadsByCampaign": {
    href: "/marketing/campaigns",
    async load(ctx) {
      const counts = new Map<string, number>();
      for (const l of await created(ctx)) if (l.campaign) counts.set(l.campaign, (counts.get(l.campaign) ?? 0) + 1);
      return topNWithOther([...counts].map(([label, value]) => ({ label, value })), 8);
    },
    render: (rows) => <BarListView rows={rows} empty="No campaign leads in this period." />,
  },
  "sales.slaBreaches": {
    href: "/leads",
    async load(ctx) {
      const n = slaBreachCount(ctx.now.getTime());
      return { value: String(n), sub: n === 1 ? "New lead unanswered" : "New leads unanswered", accent: n > 0 };
    },
    render: kpi,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<SalesKey, WidgetImpl<any>>;
