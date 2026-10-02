import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { DonutView } from "@/components/dashboard/views/DonutView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { formatEur } from "@/lib/utils";
import { churnPct, gainedLostByBucket, methodTotals, revenueByBucket, revenueSummary } from "../metrics/finance";
import {
  churnCounts,
  membershipEvents,
  packageUse,
  paymentsIn,
  renewalsBetween,
  revenueByService,
  topSpenders,
  voucherStats,
} from "../metrics/financeQueries";
import { addDaysIso, dublinIso, seriesBuckets, shortDay } from "../metrics/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { FinanceKey } from "./keys";

const payments = (ctx: WidgetCtx, previous = false) => {
  const r = previous ? ctx.previous : ctx.range;
  return cached(ctx, `finance.payments:${r.fromMs}:${r.toMs}`, () => paymentsIn(r.fromMs, r.toMs));
};

const noData = (text: string) => (
  <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{text}</div>
);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const FINANCE_WIDGETS = {
  "finance.revenue": {
    href: "/reports",
    async load(ctx) {
      const cur = revenueSummary(await payments(ctx));
      const prev = revenueSummary(await payments(ctx, true));
      return {
        value: formatEur(cur.total),
        sub: plural(cur.count, "payment", "payments"),
        delta: deltaPct(cur.total, prev.total),
        accent: cur.total > 0,
      };
    },
    render: kpi,
  },
  "finance.avgSpend": {
    href: "/reports",
    async load(ctx) {
      const cur = revenueSummary(await payments(ctx));
      const prev = revenueSummary(await payments(ctx, true));
      if (cur.clients === 0) return { value: "No payments", sub: ctx.range.label };
      const avg = cur.total / cur.clients;
      const prevAvg = prev.clients > 0 ? prev.total / prev.clients : 0;
      return {
        value: formatEur(avg),
        sub: `across ${plural(cur.clients, "client", "clients")}`,
        delta: deltaPct(avg, prevAvg),
      };
    },
    render: kpi,
  },
  "finance.revenueTrend": {
    href: "/reports",
    async load(ctx) {
      const [cur, prev] = await Promise.all([payments(ctx), payments(ctx, true)]);
      const buckets = seriesBuckets(ctx.range.fromMs, ctx.range.toMs);
      const prevBuckets = seriesBuckets(ctx.previous.fromMs, ctx.previous.toMs);
      const now = revenueByBucket(cur, buckets);
      const before = revenueByBucket(prev, prevBuckets);
      return buckets.map((b, i) => ({ label: b.label, Payments: now[i], Previous: before[i] ?? 0 }));
    },
    render: (data: { label: string; Payments: number; Previous: number }[]) =>
      data.every((r) => r.Payments === 0 && r.Previous === 0) ? (
        noData("No payments in this period.")
      ) : (
        <SeriesChart
          data={data}
          xKey="label"
          kind="bar"
          series={[
            { key: "Payments", label: "Payments (EUR)" },
            { key: "Previous", label: "Previous period (EUR)", color: "var(--text-tertiary)" },
          ]}
        />
      ),
  },
  "finance.byMethod": {
    href: "/reports",
    async load(ctx) {
      return methodTotals(await payments(ctx));
    },
    render: (data: { label: string; value: number }[]) => <DonutView data={data} empty="No payments in this period." />,
  },
  "finance.topClients": {
    href: "/clients",
    async load(ctx) {
      return topSpenders(await payments(ctx), 8);
    },
    render: (rows: { clientId: number; name: string; total: number }[]) => (
      <BarListView
        rows={rows.map((r) => ({ label: r.name, value: r.total, display: formatEur(r.total), href: `/clients/${r.clientId}` }))}
        empty="No payments in this period."
      />
    ),
  },
  "finance.vouchers": {
    href: "/vouchers",
    async load(ctx) {
      return voucherStats(ctx.range.fromMs, ctx.range.toMs, dublinIso(ctx.now.getTime()));
    },
    render: (v: Awaited<ReturnType<typeof voucherStats>>) => {
      if (v.outstanding === 0 && v.soldCount === 0 && v.redeemedCount === 0) return noData("No gift vouchers outstanding, sold or redeemed.");
      return (
        <BarListView
          rows={[
            { label: "Outstanding balance", value: v.outstanding, display: formatEur(v.outstanding) },
            { label: `Sold (${v.soldCount})`, value: v.soldValue, display: formatEur(v.soldValue) },
            { label: `Redeemed (${v.redeemedCount})`, value: v.redeemedValue, display: formatEur(v.redeemedValue) },
          ]}
          empty="No gift vouchers outstanding, sold or redeemed."
        />
      );
    },
  },
  "finance.byService": {
    href: "/reports",
    async load(ctx) {
      return revenueByService(ctx.range.fromIso, ctx.range.toIso, 8);
    },
    render: (rows: { label: string; value: number }[]) => (
      <BarListView
        rows={rows.map((r) => ({ ...r, display: formatEur(r.value) }))}
        empty="No completed appointments with a price in this period."
      />
    ),
  },
  "finance.packages": {
    href: "/packages",
    async load() {
      return packageUse();
    },
    render: (u: Awaited<ReturnType<typeof packageUse>>) =>
      u.activeCount === 0 ? (
        noData("No active packages.")
      ) : (
        <BarListView
          rows={[
            { label: "Average use", value: u.avgPct, display: `${u.avgPct}%` },
            { label: "Sessions used", value: u.used, display: `${u.used} of ${u.sold} sold` },
            { label: "Stalled packages", value: u.stalled, display: String(u.stalled) },
          ]}
          empty="No active packages."
        />
      ),
  },
  "finance.churn": {
    href: "/memberships",
    async load(ctx) {
      const cur = churnCounts(ctx.range.fromMs, ctx.range.toMs);
      const prev = churnCounts(ctx.previous.fromMs, ctx.previous.toMs);
      const p = churnPct(cur.ended, cur.activeAtStart);
      const pp = churnPct(prev.ended, prev.activeAtStart);
      return {
        value: p === null ? "No members at the start" : `${p}%`,
        sub: `${cur.ended} ended of ${cur.activeAtStart} active at the start`,
        delta: p !== null && pp !== null ? deltaPct(p, pp) : null,
        goodWhen: "down" as const,
      };
    },
    render: kpi,
  },
  "finance.membersGainedLost": {
    href: "/memberships",
    async load(ctx) {
      const ev = membershipEvents(ctx.range.fromMs, ctx.range.toMs);
      return gainedLostByBucket(ev.created, ev.ended, seriesBuckets(ctx.range.fromMs, ctx.range.toMs));
    },
    render: (data: { label: string; Gained: number; Lost: number }[]) =>
      data.every((r) => r.Gained === 0 && r.Lost === 0) ? (
        noData("No memberships started or ended in this period.")
      ) : (
        <SeriesChart
          data={data}
          xKey="label"
          kind="bar"
          series={[
            { key: "Gained", label: "Gained" },
            { key: "Lost", label: "Lost", color: "var(--text-tertiary)" },
          ]}
        />
      ),
  },
  "finance.renewals": {
    href: "/memberships",
    async load(ctx) {
      const from = dublinIso(ctx.now.getTime());
      const list = await renewalsBetween(from, addDaysIso(from, 14), 10);
      return list.map((r) => ({
        id: r.id,
        primary: r.client,
        secondary: `${r.plan}, ${formatEur(r.amountCents / 100)}`,
        meta: shortDay(r.date),
        href: `/clients/${r.clientId}`,
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No renewals due in the next 14 days." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<FinanceKey, WidgetImpl<any>>;
