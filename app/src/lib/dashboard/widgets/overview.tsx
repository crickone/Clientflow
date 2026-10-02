import "server-only";

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { RevenueBars } from "@/components/charts/RevenueBars";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import { KpiTile } from "@/components/dashboard/views/KpiTile";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { StageBars } from "@/components/dashboard/views/StageBars";
import { TodaysClassesView } from "@/components/dashboard/views/TodaysClassesView";
import { TodaysScheduleView } from "@/components/dashboard/views/TodaysScheduleView";
import { getGymDashboard, getNeedsAttention } from "@/lib/dashboard";
import { db, schema } from "@/lib/db";
import { defaultPipelineId } from "@/lib/pipeline/pipelineRepo";
import {
  dashboardKpis,
  getTherapyMap,
  listAppointmentsForDate,
  recentActivity,
  revenueSeries,
} from "@/lib/queries";
import { formatEur, relativeTime } from "@/lib/utils";
import type { OverviewKey } from "./keys";
import { cached } from "./cache";
import { deltaPct } from "../range";
import { fillDays } from "../series";
import type { WidgetCtx, WidgetImpl } from "../types";

export { fillDays };

const kpis = (ctx: WidgetCtx) => cached(ctx, "dashboardKpis", dashboardKpis);
const gym = (ctx: WidgetCtx) => cached(ctx, "gymDashboard", getGymDashboard);

function countLeads(fromMs: number, toMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(gte(schema.leads.createdAt, new Date(fromMs)), lt(schema.leads.createdAt, new Date(toMs))))
    .get();
  return Number(row?.n ?? 0);
}

export const OVERVIEW_WIDGETS = {
  "overview.todaysBookings": {
    label: (ctx) => `Today's ${ctx.vocab.bookings.toLowerCase()}`,
    href: "/appointments",
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: String(k.todaysCount), sub: `${k.confirmed} confirmed, ${k.pending} pending` };
    },
    render: kpi,
  },
  "overview.todaysEarnings": {
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: formatEur(k.todaysEarnings), sub: "From sessions completed today" };
    },
    render: kpi,
  },
  "overview.cashToday": {
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: formatEur(k.todaysCash), sub: "Payments recorded today" };
    },
    render: kpi,
  },
  "overview.deferredRevenue": {
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: formatEur(k.deferredRevenue), sub: "Unused credits and open vouchers" };
    },
    render: kpi,
  },
  "overview.activeClients": {
    label: (ctx) => `Active ${ctx.vocab.members.toLowerCase()}`,
    href: "/clients",
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: String(k.activeClients), sub: "Visited in the last 90 days" };
    },
    render: kpi,
  },
  "overview.plansExpiring": {
    label: (ctx) => `${ctx.vocab.plans} expiring`,
    href: "/packages",
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: String(k.expiringSoon), sub: "In the next 30 days", accent: k.expiringSoon > 0 };
    },
    render: kpi,
  },
  "overview.todaysSchedule": {
    href: "/appointments/new",
    async load(ctx) {
      const today = ctx.now.toISOString().slice(0, 10);
      const [todays, therapyMap] = await Promise.all([listAppointmentsForDate(today), getTherapyMap()]);
      const ids = [...new Set(todays.map((a) => a.clientId))];
      const clients = new Map(
        ids.length
          ? db
              .select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
              .from(schema.clients)
              .where(inArray(schema.clients.id, ids))
              .all()
              .map((c) => [c.id, `${c.firstName} ${c.lastName}`] as const)
          : [],
      );
      return todays.map((a) => {
        const therapyIds: number[] = JSON.parse(a.therapyIds || "[]");
        return {
          id: a.id,
          startTime: a.startTime,
          status: a.status,
          clientName: clients.get(a.clientId) ?? "Unknown client",
          therapies: therapyIds
            .map((id) => therapyMap.get(id))
            .filter(Boolean)
            .map((t) => ({ id: t!.id, name: t!.name, colourHex: t!.colourHex })),
        };
      });
    },
    render: (items, ctx) => (
      <TodaysScheduleView items={items} empty={`No ${ctx.vocab.bookings.toLowerCase()} today.`} />
    ),
  },
  "overview.activeMembers": {
    href: "/memberships",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: String(g.activeMembers), sub: "On active memberships" };
    },
    render: kpi,
  },
  "overview.mrr": {
    href: "/memberships",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: formatEur(g.mrrCents / 100), sub: "From active memberships" };
    },
    render: kpi,
  },
  "overview.classesThisWeek": {
    href: "/timetable",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: String(g.classesThisWeek), sub: "Scheduled" };
    },
    render: kpi,
  },
  "overview.attendance": {
    href: "/attendance",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: g.attendanceRatePct === null ? "None yet" : `${g.attendanceRatePct}%`, sub: "Last 30 days" };
    },
    render: kpi,
  },
  "overview.todaysClasses": {
    href: "/timetable",
    async load(ctx) {
      return (await gym(ctx)).todayClasses;
    },
    render: (classes) => <TodaysClassesView classes={classes} />,
  },
  "overview.newLeads": {
    href: "/leads",
    async load(ctx) {
      const cur = countLeads(ctx.range.fromMs, ctx.range.toMs);
      const prev = countLeads(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev), accent: cur > 0 };
    },
    render: kpi,
  },
  "overview.unreadMessages": {
    href: "/communication",
    async load() {
      const row = db
        .select({ n: sql<number>`count(*)` })
        .from(schema.emailMessages)
        .where(and(eq(schema.emailMessages.direction, "in"), eq(schema.emailMessages.isRead, false)))
        .get();
      const n = Number(row?.n ?? 0);
      return { value: String(n), sub: n === 1 ? "Unread email" : "Unread emails", accent: n > 0 };
    },
    render: kpi,
  },
  "overview.needsAttention": {
    async load() {
      return getNeedsAttention();
    },
    render: (items) =>
      items.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 14 }}>Nothing needs your attention right now.</div>
      ) : (
        <NeedsAttention items={items} />
      ),
  },
  "overview.recentActivity": {
    async load() {
      const rows = await recentActivity(10);
      return rows.map((a) => ({ id: a.id, primary: a.message, meta: relativeTime(a.createdAt) }));
    },
    render: (rows) => <RowList rows={rows} empty="No activity yet." />,
  },
  "overview.revenueTrend": {
    href: "/reports",
    async load(ctx) {
      const [cur, prev] = await Promise.all([
        revenueSeries(ctx.range.fromIso, ctx.range.toIso),
        revenueSeries(ctx.previous.fromIso, ctx.previous.toIso),
      ]);
      const series = fillDays(cur, ctx.range.fromIso, ctx.range.days);
      const total = series.reduce((s, d) => s + d.total, 0);
      const prevTotal = prev.reduce((s, d) => s + Number(d.total || 0), 0);
      return { series, total, delta: deltaPct(total, prevTotal) };
    },
    render: (d, ctx) =>
      d.total === 0 ? (
        <div style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14, textAlign: "center" }}>
          No revenue recorded in this period.
        </div>
      ) : (
        <>
          <KpiTile value={formatEur(d.total)} sub={ctx.range.label} delta={d.delta} />
          <div style={{ marginTop: 12 }}>
            <RevenueBars data={d.series} />
          </div>
        </>
      ),
  },
  "overview.pipelineSnapshot": {
    href: "/leads",
    async load() {
      const pid = defaultPipelineId();
      const stages = db
        .select({ id: schema.pipelineStages.id, name: schema.pipelineStages.name })
        .from(schema.pipelineStages)
        .where(eq(schema.pipelineStages.pipelineId, pid))
        .orderBy(asc(schema.pipelineStages.position))
        .all();
      const counts = db
        .select({ stageId: schema.leads.stageId, n: sql<number>`count(*)` })
        .from(schema.leads)
        .where(eq(schema.leads.pipelineId, pid))
        .groupBy(schema.leads.stageId)
        .all();
      const byStage = new Map(counts.map((c) => [c.stageId, Number(c.n)]));
      return stages.map((s) => ({ id: s.id, name: s.name, count: byStage.get(s.id) ?? 0 }));
    },
    render: (stages) => <StageBars stages={stages} empty="No leads in the pipeline yet." />,
  },
  "overview.upcomingPosts": {
    href: "/content-studio",
    async load(ctx) {
      const rows = db
        .select({
          id: schema.scheduledPosts.id,
          when: schema.scheduledPosts.scheduledFor,
          name: schema.carouselSets.name,
        })
        .from(schema.scheduledPosts)
        .leftJoin(schema.carouselSets, eq(schema.carouselSets.id, schema.scheduledPosts.carouselSetId))
        .where(and(eq(schema.scheduledPosts.status, "scheduled"), gte(schema.scheduledPosts.scheduledFor, ctx.now)))
        .orderBy(asc(schema.scheduledPosts.scheduledFor))
        .limit(5)
        .all();
      return rows.map((r) => ({
        id: r.id,
        primary: r.name ?? "Untitled post",
        meta: r.when.toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }),
      }));
    },
    render: (rows) => <RowList rows={rows} empty="Nothing scheduled. Plan a post in Content Studio." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<OverviewKey, WidgetImpl<any>>;
