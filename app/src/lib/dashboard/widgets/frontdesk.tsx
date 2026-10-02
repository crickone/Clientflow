import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { DonutView } from "@/components/dashboard/views/DonutView";
import { HeatmapView } from "@/components/dashboard/views/HeatmapView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { getSettings } from "@/lib/settings";
import { dublinLocalToMs, upcomingBirthdays, utilisationByWeekday } from "../metrics/frontdesk";
import {
  activeAppointmentsIn,
  bookingsBetween,
  cancelLeadTimeCounts,
  clientsWithBirthdays,
  expiringCredits,
  newReturningCounts,
  outcomeCounts,
  serviceSplit,
} from "../metrics/frontdeskQueries";
import { addDaysIso, dublinIso, pct, shortDay, weekBounds, weekdayHourGrid } from "../metrics/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { FrontdeskKey } from "./keys";

const MAX_UTILISATION_DAYS = 31;

const appts = (ctx: WidgetCtx) =>
  cached(ctx, `frontdesk.appts:${ctx.range.fromIso}:${ctx.range.toIso}`, () =>
    activeAppointmentsIn(ctx.range.fromIso, ctx.range.toIso),
  );

const outcomes = (ctx: WidgetCtx, previous = false) => {
  const r = previous ? ctx.previous : ctx.range;
  return cached(ctx, `frontdesk.outcomes:${r.fromIso}:${r.toIso}`, () => outcomeCounts(r.fromIso, r.toIso));
};

const rateTile = (pick: "noShow" | "cancelled") =>
  async function load(ctx: WidgetCtx) {
    const [cur, prev] = await Promise.all([outcomes(ctx), outcomes(ctx, true)]);
    const p = pct(cur[pick], cur.total);
    const pp = pct(prev[pick], prev.total);
    return {
      value: p === null ? "No finished appointments" : `${p}%`,
      sub: `${cur[pick]} of ${cur.total}`,
      delta: p !== null && pp !== null ? deltaPct(p, pp) : null,
      goodWhen: "down" as const,
    };
  };


export const FRONTDESK_WIDGETS = {
  "frontdesk.weekBookings": {
    href: "/appointments",
    async load(ctx) {
      const { mon, sun } = weekBounds(dublinIso(ctx.now.getTime()));
      const b = bookingsBetween(mon, sun);
      return { value: String(b.total), sub: `${b.confirmed} confirmed`, accent: b.total > 0 };
    },
    render: kpi,
  },
  "frontdesk.noShowRate": { href: "/appointments", load: rateTile("noShow"), render: kpi },
  "frontdesk.cancellationRate": { href: "/appointments", load: rateTile("cancelled"), render: kpi },
  "frontdesk.birthdays": {
    href: "/clients",
    async load(ctx) {
      const list = upcomingBirthdays(clientsWithBirthdays(), dublinIso(ctx.now.getTime()), 7);
      return list.map((b) => ({ id: `${b.id}:${b.date}`, primary: b.name, meta: shortDay(b.date), href: `/clients/${b.id}` }));
    },
    render: (rows) => <RowList rows={rows} empty="No birthdays in the next 7 days." />,
  },
  "frontdesk.utilisation": {
    href: "/appointments",
    async load(ctx) {
      const all = Math.min(ctx.range.days, MAX_UTILISATION_DAYS);
      const capped = ctx.range.days > MAX_UTILISATION_DAYS;
      const days = Array.from({ length: all }, (_, i) => addDaysIso(ctx.range.toIso, i - all + 1));
      const rows = (await appts(ctx)).filter((a) => a.date >= days[0]);
      const u = utilisationByWeekday(rows, days, getSettings().openingHours);
      return { ...u, capped, shown: all };
    },
    render: (d: { rows: { label: string; pct: number | null; booked: number; open: number }[]; overallPct: number | null; capped: boolean; shown: number }) => {
      const open = d.rows.filter((r) => r.open > 0);
      if (open.length === 0) {
        return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No opening hours fall in this period.</div>;
      }
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
            {d.overallPct === null ? "No open time" : `${d.overallPct}% of opening hours booked`}
            {d.capped ? `, last ${d.shown} days of the period` : ""}
          </div>
          <BarListView
            rows={open.map((r) => ({ label: r.label, value: r.pct ?? 0, display: `${r.label} ${Math.round(r.pct ?? 0)}%` }))}
            max={100}
            empty="No opening hours fall in this period."
          />
        </div>
      );
    },
  },
  "frontdesk.busiestTimes": {
    href: "/appointments",
    async load(ctx) {
      const times = (await appts(ctx)).map((a) => dublinLocalToMs(a.date, a.startTime));
      return weekdayHourGrid(times, "Europe/Dublin");
    },
    render: (grid: number[][]) => <HeatmapView grid={grid} empty="No appointments in this period." />,
  },
  "frontdesk.sessionsByService": {
    href: "/reports",
    async load(ctx) {
      return serviceSplit(ctx.range.fromIso, ctx.range.toIso);
    },
    render: (data: Awaited<ReturnType<typeof serviceSplit>>) => (
      <DonutView data={data} empty="No completed sessions in this period." />
    ),
  },
  "frontdesk.newVsReturning": {
    href: "/clients",
    async load(ctx) {
      return newReturningCounts(ctx.range.fromIso, ctx.range.toIso);
    },
    render: (d: { newClients: number; returning: number }) => {
      const total = d.newClients + d.returning;
      return (
        <BarListView
          rows={[
            { label: "New", value: d.newClients, display: `${Math.round(pct(d.newClients, total) ?? 0)}% (${d.newClients})` },
            { label: "Returning", value: d.returning, display: `${Math.round(pct(d.returning, total) ?? 0)}% (${d.returning})` },
          ].filter(() => total > 0)}
          max={Math.max(1, total)}
          empty="No completed appointments in this period."
        />
      );
    },
  },
  "frontdesk.cancelLeadTime": {
    href: "/appointments",
    async load(ctx) {
      return cancelLeadTimeCounts(ctx.range.fromMs, ctx.range.toMs);
    },
    render: (rows: { label: string; value: number }[]) => (
      <BarListView
        rows={rows.some((r) => r.value > 0) ? rows : []}
        empty="No cancellations with a recorded date in this period."
      />
    ),
  },
  "frontdesk.creditsExpiring": {
    href: "/packages",
    async load() {
      return (await expiringCredits(10)).map((c) => ({
        id: c.id,
        primary: c.client,
        secondary: c.packageName,
        meta: `${c.left} left, expires ${shortDay(c.expiryDate).split(" ").slice(1).join(" ")}`,
        href: `/clients/${c.clientId}`,
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No package credits expire in the next 30 days." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<FrontdeskKey, WidgetImpl<any>>;
