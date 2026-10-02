import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { HeatmapView } from "@/components/dashboard/views/HeatmapView";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { TableView } from "@/components/dashboard/views/TableView";
import { fillByGroup, fillBySlotGrid, instructorRows } from "../metrics/classes";
import { bookingsMadeIn, quietActiveMembers, sessionFills } from "../metrics/classesQueries";
import { addDaysIso, dublinIso, pct, shortDay } from "../metrics/stats";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { ClassesKey } from "./keys";

const fills = (ctx: WidgetCtx, previous = false) => {
  const r = previous ? ctx.previous : ctx.range;
  return cached(ctx, `classes.fills:${r.fromIso}:${r.toIso}`, () => sessionFills(r.fromIso, r.toIso));
};

const sum = (xs: number[]) => xs.reduce((s, n) => s + n, 0);
const NOT_HELD = "No classes in this period.";
const MONTH_DAY = (iso: string) => shortDay(iso).split(" ").slice(1).join(" ");

/** Sessions already held: dated up to today (Dublin), within the range. */
function held<T extends { date: string }>(rows: T[], ctx: WidgetCtx): T[] {
  const today = dublinIso(ctx.now.getTime());
  return rows.filter((s) => s.date <= today);
}

export const CLASSES_WIDGETS = {
  "classes.avgFill": {
    href: "/timetable",
    async load(ctx) {
      const [cur, prev] = await Promise.all([fills(ctx), fills(ctx, true)]);
      const p = pct(sum(cur.map((s) => s.booked)), sum(cur.map((s) => s.capacity)));
      const pp = pct(sum(prev.map((s) => s.booked)), sum(prev.map((s) => s.capacity)));
      return {
        value: p === null ? "No classes" : `${p}%`,
        sub: `${cur.length} ${cur.length === 1 ? "class" : "classes"}`,
        delta: p !== null && pp !== null ? deltaPct(p, pp) : null,
        accent: p !== null && p >= 75,
      };
    },
    render: kpi,
  },
  "classes.attendanceRate": {
    href: "/attendance",
    async load(ctx) {
      const rate = (rows: { attended: number; noShow: number }[]) =>
        pct(sum(rows.map((s) => s.attended)), sum(rows.map((s) => s.attended + s.noShow)));
      const [cur, prev] = await Promise.all([fills(ctx), fills(ctx, true)]);
      const c = held(cur, ctx);
      const p = rate(c);
      const pp = rate(held(prev, ctx));
      return {
        value: p === null ? "Nothing marked yet" : `${p}%`,
        sub: `${sum(c.map((s) => s.attended))} of ${sum(c.map((s) => s.attended + s.noShow))} marked`,
        delta: p !== null && pp !== null ? deltaPct(p, pp) : null,
      };
    },
    render: kpi,
  },
  "classes.noShows": {
    href: "/attendance",
    async load(ctx) {
      const [cur, prev] = await Promise.all([fills(ctx), fills(ctx, true)]);
      const c = sum(cur.map((s) => s.noShow));
      return { value: String(c), sub: ctx.range.label, delta: deltaPct(c, sum(prev.map((s) => s.noShow))), goodWhen: "down" as const };
    },
    render: kpi,
  },
  "classes.newBookings": {
    href: "/timetable",
    async load(ctx) {
      const cur = bookingsMadeIn(ctx.range.fromMs, ctx.range.toMs);
      const prev = bookingsMadeIn(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev), accent: cur > 0 };
    },
    render: kpi,
  },
  "classes.fillByType": {
    href: "/timetable",
    async load(ctx) {
      return fillByGroup(
        (await fills(ctx)).map((s) => ({ key: s.category?.trim() || s.name, booked: s.booked, capacity: s.capacity })),
        8,
      );
    },
    render: (rows: ReturnType<typeof fillByGroup>) => (
      <BarListView
        rows={rows.map((r) => ({ label: r.label, value: r.pct, display: `${Math.round(r.pct)}% (${r.booked}/${r.capacity})` }))}
        max={100}
        empty={NOT_HELD}
      />
    ),
  },
  "classes.fillBySlot": {
    href: "/timetable",
    async load(ctx) {
      return fillBySlotGrid(await fills(ctx));
    },
    render: (grid: number[][]) => <HeatmapView grid={grid} empty={NOT_HELD} />,
  },
  "classes.instructors": {
    href: "/timetable",
    async load(ctx) {
      return instructorRows(await fills(ctx));
    },
    render: (rows: ReturnType<typeof instructorRows>) => (
      <TableView
        columns={[
          { key: "name", label: "Instructor" },
          { key: "classes", label: "Classes", align: "right" },
          { key: "fill", label: "Avg fill", align: "right" },
          { key: "attendance", label: "Attendance", align: "right" },
        ]}
        rows={rows.map((r) => ({
          name: r.name,
          classes: r.classes,
          fill: r.fillPct === null ? "-" : `${Math.round(r.fillPct)}%`,
          attendance: r.attendancePct === null ? "-" : `${Math.round(r.attendancePct)}%`,
        }))}
        empty={NOT_HELD}
      />
    ),
  },
  "classes.fullClasses": {
    href: "/timetable",
    async load(ctx) {
      const today = dublinIso(ctx.now.getTime());
      const rows = await cached(ctx, `classes.upcoming:${today}`, () => sessionFills(today, addDaysIso(today, 6)));
      return rows
        .filter((s) => s.capacity > 0 && s.booked >= s.capacity)
        .map((s) => ({
          id: s.id,
          primary: `${shortDay(s.date)} ${s.startTime}, ${s.name}`,
          meta: `${s.booked}/${s.capacity}`,
          href: "/timetable",
        }));
    },
    render: (rows) => <RowList rows={rows} empty="No classes are full in the next 7 days." />,
  },
  "classes.inactiveMembers": {
    href: "/clients",
    async load(ctx) {
      return quietActiveMembers(ctx.now.getTime(), 30, 10).map((m) => ({
        id: m.id,
        primary: m.name,
        meta: m.lastMs === null ? "never" : `last visit ${MONTH_DAY(new Date(m.lastMs).toISOString().slice(0, 10))}`,
        href: `/clients/${m.id}`,
      }));
    },
    render: (rows) => <RowList rows={rows} empty="Every active member has been in during the last 30 days." />,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<ClassesKey, WidgetImpl<any>>;
