import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { DonutView } from "@/components/dashboard/views/DonutView";
import { HeatmapView } from "@/components/dashboard/views/HeatmapView";
import { kpi } from "@/components/dashboard/views/kpi";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { TableView } from "@/components/dashboard/views/TableView";
import { getEmailBalanceCents, isMarketingSuspended } from "@/lib/email/credits";
import { getSentThisMonth, getTenantIncludedSends } from "@/lib/email/included";
import { formatEur } from "@/lib/utils";
import { campaignRates, linkLabel, netDeltaPct, sumCounts } from "../metrics/email";
import {
  campaignsSentIn,
  contactSourceCounts,
  engagementSeries,
  eventsIn,
  listChange,
  listGrowthSeries,
  openTimes,
  statusCounts,
  subscribedNow,
  suppressionCounts,
  topLinks,
} from "../metrics/emailQueries";
import { topNWithOther } from "../metrics/sales";
import { weekdayHourGrid } from "../metrics/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { EmailKey } from "./keys";

const sentIn = (ctx: WidgetCtx) => cached(ctx, "email.sentCampaigns", () => campaignsSentIn(ctx.range.fromMs, ctx.range.toMs));
const sentPrev = (ctx: WidgetCtx) => cached(ctx, "email.sentCampaignsPrev", () => campaignsSentIn(ctx.previous.fromMs, ctx.previous.toMs));

const events = (ctx: WidgetCtx, event: "opened" | "clicked") =>
  cached(ctx, `email.events:${event}:${ctx.range.fromMs}:${ctx.range.toMs}`, () => eventsIn(event, ctx.range.fromMs, ctx.range.toMs));

const rates = (cs: { counts: Record<string, number> }[]) => campaignRates(sumCounts(cs.map((c) => c.counts)));
const fmtPct = (v: number | null) => (v === null ? null : `${v}%`);
const num = (n: number) => n.toLocaleString("en-IE");
const dubDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const EMPTY_PERIOD = "No campaigns sent in this period.";

const rateTile = (pick: (r: ReturnType<typeof campaignRates>) => number | null, label: string) => ({
  href: "/campaigns",
  async load(ctx: WidgetCtx) {
    const [cur, prev] = await Promise.all([sentIn(ctx), sentPrev(ctx)]);
    const r = rates(cur);
    const v = pick(r);
    const p = pick(rates(prev));
    if (v === null) return { value: cur.length === 0 ? "No campaigns" : "No delivered email", sub: `${label}, ${cur.length === 0 ? "none sent in this period" : "nothing delivered yet"}` };
    return { value: `${v}%`, sub: `${label}, ${ctx.range.label}`, delta: p === null ? null : deltaPct(v, p) };
  },
  render: kpi,
});

const THRESHOLDS = { bounce: 2, complaint: 0.1 } as const;

export const EMAIL_WIDGETS = {
  "email.subscribers": {
    href: "/campaigns/contacts",
    async load(ctx) {
      const cur = listChange(ctx.range.fromMs, ctx.range.toMs);
      const prev = listChange(ctx.previous.fromMs, ctx.previous.toMs);
      return {
        value: num(subscribedNow()),
        sub: `+${cur.adds} / -${cur.unsubs} ${ctx.range.label}`,
        delta: netDeltaPct(cur.adds - cur.unsubs, prev.adds - prev.unsubs),
      };
    },
    render: kpi,
  },
  "email.openRate": rateTile((r) => r.openRate, "Opens of delivered email"),
  "email.clickRate": rateTile((r) => r.clickRate, "Clicks of delivered email"),
  "email.credits": {
    href: "/campaigns",
    async load(ctx) {
      const cents = getEmailBalanceCents(ctx.tenantId);
      const paused = isMarketingSuspended(ctx.tenantId);
      return { value: formatEur(cents / 100), sub: paused ? "Sending paused" : "Prepaid balance" };
    },
    render: kpi,
  },
  "email.listGrowth": {
    href: "/campaigns/contacts",
    async load(ctx) {
      return listGrowthSeries(ctx.range.fromMs, ctx.range.toMs);
    },
    render: (data: Record<string, string | number>[]) =>
      data.every((r) => r.Adds === 0 && r.Unsubscribes === 0) ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No contacts joined or left in this period.</div>
      ) : (
        <SeriesChart
          data={data}
          xKey="label"
          kind="bar"
          series={[
            { key: "Adds", label: "Joined" },
            { key: "Unsubscribes", label: "Unsubscribed", color: "var(--text-tertiary)" },
          ]}
        />
      ),
  },
  "email.statusMix": {
    href: "/campaigns/contacts",
    async load() {
      return statusCounts().map((r) => ({
        label: cap(r.label),
        value: r.value,
        color: r.label === "subscribed" ? "var(--accent)" : "var(--text-tertiary)",
      }));
    },
    render: (data: { label: string; value: number; color: string }[]) => <DonutView data={data} empty="No contacts yet." />,
  },
  "email.campaignTable": {
    href: "/campaigns",
    async load(ctx) {
      return (await sentIn(ctx)).slice(0, 12).map((c) => {
        const r = campaignRates(c.counts);
        return {
          id: c.id,
          Campaign: c.name,
          Sent: dubDate(c.sentAtMs),
          Recipients: Object.values(c.counts).reduce((a, b) => a + b, 0),
          Delivered: fmtPct(r.deliveredRate),
          Open: fmtPct(r.openRate),
          Click: fmtPct(r.clickRate),
          Bounce: fmtPct(r.bounceRate),
          Unsubscribe: fmtPct(r.unsubscribeRate),
        };
      });
    },
    render: (rows: Record<string, string | number | null>[]) => (
      <TableView
        columns={[
          { key: "Campaign", label: "Campaign" },
          { key: "Sent", label: "Sent" },
          { key: "Recipients", label: "Recipients", align: "right" },
          { key: "Delivered", label: "Delivered %", align: "right" },
          { key: "Open", label: "Open %", align: "right" },
          { key: "Click", label: "Click %", align: "right" },
          { key: "Bounce", label: "Bounce %", align: "right" },
          { key: "Unsubscribe", label: "Unsubscribe %", align: "right" },
        ]}
        rows={rows}
        empty="No campaigns sent in this period."
      />
    ),
  },
  "email.engagementTrend": {
    href: "/campaigns",
    async load(ctx) {
      const [opened, clicked] = await Promise.all([events(ctx, "opened"), events(ctx, "clicked")]);
      return engagementSeries(ctx.range.fromMs, ctx.range.toMs, { opened, clicked });
    },
    render: (data: Record<string, string | number>[]) =>
      data.every((r) => r.Opens === 0 && r.Clicks === 0) ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No opens or clicks recorded in this period.</div>
      ) : (
        <SeriesChart
          data={data}
          xKey="label"
          series={[
            { key: "Opens", label: "Opens" },
            { key: "Unique opens", label: "Unique opens", dashed: true },
            { key: "Clicks", label: "Clicks", color: "var(--text-secondary)" },
            { key: "Unique clicks", label: "Unique clicks", color: "var(--text-secondary)", dashed: true },
          ]}
        />
      ),
  },
  "email.topLinks": {
    href: "/campaigns",
    async load(ctx) {
      return topLinks(ctx.range.fromMs, ctx.range.toMs, 8, await events(ctx, "clicked")).map((l) => ({
        label: linkLabel(l.url),
        value: l.clicks,
        sub: `${l.uniques} unique ${l.uniques === 1 ? "send" : "sends"}`,
      }));
    },
    render: (rows: { label: string; value: number; sub: string }[]) => <BarListView rows={rows} empty="No clicks yet." />,
  },
  "email.sendTimeHeatmap": {
    href: "/campaigns",
    async load(ctx) {
      return weekdayHourGrid(openTimes(ctx.range.fromMs, ctx.range.toMs, await events(ctx, "opened")), "Europe/Dublin");
    },
    render: (grid: number[][]) => <HeatmapView grid={grid} empty="No opens yet." />,
  },
  "email.deliverability": {
    href: "/campaigns",
    async load(ctx) {
      const cur = await sentIn(ctx);
      const r = rates(cur);
      return {
        any: r.reached > 0 || (sumCounts(cur.map((c) => c.counts)).bounced ?? 0) > 0,
        rows: [
          { label: "Bounce rate", rate: r.bounceRate, limit: THRESHOLDS.bounce },
          { label: "Complaint rate", rate: r.complaintRate, limit: THRESHOLDS.complaint },
        ],
      };
    },
    render: (d: { any: boolean; rows: { label: string; rate: number | null; limit: number }[] }) =>
      !d.any ? (
        <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{EMPTY_PERIOD}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {d.rows.map((r) => {
            const over = r.rate !== null && r.rate > r.limit;
            return (
              <div key={r.label}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: over ? "var(--danger, #e5484d)" : "var(--text-primary)" }}>
                  {r.label} {r.rate ?? 0}%
                </div>
                <div style={{ fontSize: 12, color: over ? "var(--danger, #e5484d)" : "var(--text-tertiary)" }}>
                  {over ? `over the ${r.limit}% limit` : `healthy under ${r.limit}%`}
                </div>
              </div>
            );
          })}
        </div>
      ),
  },
  "email.suppressions": {
    href: "/campaigns/contacts",
    async load() {
      const rows = suppressionCounts().map((r) => ({ label: cap(r.label), value: r.value })).sort((a, b) => b.value - a.value);
      return { rows, total: rows.reduce((a, r) => a + r.value, 0) };
    },
    render: (d: { rows: { label: string; value: number }[]; total: number }) => (
      <div>
        <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 8 }}>{num(d.total)} total</div>
        <BarListView rows={d.rows} empty="No suppressed addresses." />
      </div>
    ),
  },
  "email.sendsThisMonth": {
    href: "/campaigns",
    async load(ctx) {
      const sent = getSentThisMonth(ctx.tenantId);
      const allowance = getTenantIncludedSends(ctx.tenantId);
      return { value: `${num(sent)} of ${num(allowance)}`, sub: sent > allowance ? "Over the included allowance" : "Included sends used", accent: sent > allowance };
    },
    render: kpi,
  },
  "email.contactSources": {
    href: "/campaigns/contacts",
    async load() {
      return topNWithOther(contactSourceCounts(), 8);
    },
    render: (rows: { label: string; value: number }[]) => <BarListView rows={rows} empty="No contacts yet." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<EmailKey, WidgetImpl<any>>;
