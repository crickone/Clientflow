import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { kpi } from "@/components/dashboard/views/kpi";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { formatEur } from "@/lib/utils";
import { agentLabel, dailySpendSeries, mediaBreakdown, projectedMonthEnd, shortModel, topPairs } from "../metrics/ai";
import {
  agentRunCounts,
  capCents,
  monthKeyAt,
  overAllowance,
  spentThisMonth,
  usageByAgent,
  usageByModel,
  usageRows,
} from "../metrics/aiQueries";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { AiKey } from "./keys";

const eur = (cents: number) => formatEur(cents / 100);
const month = (ctx: WidgetCtx) => monthKeyAt(ctx.now.getTime());
const rows = (ctx: WidgetCtx) => cached(ctx, "ai.rows", () => usageRows(ctx.tenantId, month(ctx)));
const empty = "No AI spend recorded this month.";

export const AI_WIDGETS = {
  "ai.spendVsCap": {
    href: "/agents",
    async load(ctx) {
      const spent = spentThisMonth(ctx.tenantId, month(ctx));
      const cap = capCents(ctx.tenantId);
      return { spent, cap, over: overAllowance(ctx.tenantId) };
    },
    render: (d: { spent: number; cap: number; over: boolean }) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <BarListView rows={[{ label: "AI spend", value: d.spent, display: `${eur(d.spent)} of ${eur(d.cap)}` }]} max={d.cap} empty="" />
        {d.over && <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Over the free allowance</div>}
      </div>
    ),
  },
  "ai.projected": {
    href: "/agents",
    async load(ctx) {
      const spent = spentThisMonth(ctx.tenantId, month(ctx));
      const projected = projectedMonthEnd(spent, ctx.now.getTime());
      const cap = capCents(ctx.tenantId);
      return { value: eur(projected), sub: `of ${eur(cap)} allowance`, accent: projected > cap };
    },
    render: kpi,
  },
  "ai.agentRuns": {
    href: "/adonis",
    async load(ctx) {
      const cur = agentRunCounts(ctx.range.fromMs, ctx.range.toMs);
      const prev = agentRunCounts(ctx.previous.fromMs, ctx.previous.toMs);
      return {
        value: String(cur.total),
        sub: `${ctx.range.label}, ${cur.errors} ${cur.errors === 1 ? "error" : "errors"}`,
        delta: deltaPct(cur.total, prev.total),
      };
    },
    render: kpi,
  },
  "ai.byAgent": {
    href: "/agents",
    async load(ctx) {
      return Object.entries(usageByAgent(ctx.tenantId, month(ctx)))
        .map(([k, cents]) => ({ label: agentLabel(k), value: cents, display: eur(cents) }))
        .sort((a, b) => b.value - a.value);
    },
    render: (r: { label: string; value: number; display: string }[]) => <BarListView rows={r} empty={empty} />,
  },
  "ai.byModel": {
    href: "/agents",
    async load(ctx) {
      return usageByModel(ctx.tenantId, month(ctx)).map((m) => ({ label: shortModel(m.model), value: m.cents, display: eur(m.cents) }));
    },
    render: (r: { label: string; value: number; display: string }[]) => <BarListView rows={r} empty={empty} />,
  },
  "ai.dailySpend": {
    href: "/agents",
    async load(ctx) {
      const days = dailySpendSeries(await rows(ctx), month(ctx));
      const total = days.reduce((s, d) => s + d.cents, 0);
      return { total, data: days.map((d) => ({ label: d.label, Spend: Math.round(d.cents) / 100 })) };
    },
    render: (d: { total: number; data: Record<string, string | number>[] }) =>
      d.total === 0 ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>
      ) : (
        <SeriesChart data={d.data} xKey="label" kind="bar" series={[{ key: "Spend", label: "Spend (EUR)" }]} />
      ),
  },
  "ai.topDrivers": {
    href: "/agents",
    async load(ctx) {
      return topPairs(await rows(ctx), 5).map((p) => ({ ...p, display: eur(p.value) }));
    },
    render: (r: { label: string; sub: string; value: number; display: string }[]) => <BarListView rows={r} empty={empty} />,
  },
  "ai.mediaSpend": {
    href: "/agents",
    async load(ctx) {
      return mediaBreakdown(await rows(ctx)).map((m) => ({ ...m, display: eur(m.value) }));
    },
    render: (r: { label: string; value: number; display: string }[]) => (
      <BarListView rows={r} empty="No image, video or audio spend this month." />
    ),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<AiKey, WidgetImpl<any>>;
