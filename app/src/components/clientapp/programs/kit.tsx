// app/src/components/clientapp/programs/kit.tsx
/**
 * The Programs kit: the shared pieces every Programs screen is built from.
 * Plain markup with no hooks, so server and client components can both use
 * it. Styles are the .pk- block in globals.css; colours come from the gym's
 * brand variables only.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Plus } from "lucide-react";

import { weeksText } from "@/lib/programs/content";
import type { LiftChart } from "@/lib/programs/progressData";
import type { ChartKind } from "@/lib/programs/progressSeries";
import type { Phase, PlannedExercise, WeightUnit } from "@/lib/programs/types";
import { formatMax, formatWeight } from "@/lib/programs/units";
import { chartScale, PAD, pathGeometry } from "./pathGeometry";
import { setLine } from "./setLine";

export { pathGeometry };

/** The page head: a small line above, the big uppercase title, a lead line and a byline. */
export function PkHeader({ crumb, title, lead, byline, children }: { crumb?: string; title: string; lead?: string; byline?: string; children?: ReactNode }) {
  return (
    <header className="pk-head">
      {crumb && <div className="pk-crumb">{crumb}</div>}
      <h1 className="pk-title">{title}</h1>
      {lead && <p className="pk-lead">{lead}</p>}
      {byline && <div className="pk-small">{byline}</div>}
      {children}
    </header>
  );
}

/** A small letter-spaced section label and what goes under it. */
export function PkSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pk-section">
      <h2 className="pk-label">{label}</h2>
      {children}
    </section>
  );
}

/** A soft card; a link when it has an href. `accent` for the one card a screen leads with. */
export function PkCard({ href, accent, children, className }: { href?: string; accent?: boolean; children: ReactNode; className?: string }) {
  const cls = `pk-card${accent ? " pk-card--accent" : ""}${className ? ` ${className}` : ""}`;
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** A pill tag: days, weeks, level, length. */
export function Pill({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={`pk-pill${accent ? " pk-pill--accent" : ""}`}>{children}</span>;
}

export function Pills({ items }: { items: string[] }) {
  return (
    <div className="pk-pills">
      {items.map((p) => (
        <Pill key={p}>{p}</Pill>
      ))}
    </div>
  );
}

/**
 * The phase bar: one segment per phase, sized by its weeks. The current phase
 * is the brightest and the ones before it are a step dimmer. `named` writes
 * each phase's name in its segment.
 */
export function PhaseBar({ phases, current = null, named = false }: { phases: Phase[]; current?: number | null; named?: boolean }) {
  const label = `Phases: ${phases.map((p) => `${p.name}, ${weeksText(p.fromWeek, p.toWeek).toLowerCase()}`).join("; ")}${current !== null && phases[current] ? `. Now: ${phases[current].name}` : ""}`;
  return (
    <div className={`pk-phases${named ? " pk-phases--named" : ""}`} role="img" aria-label={label}>
      {phases.map((p, i) => (
        <div
          key={`${p.fromWeek}-${p.name}`}
          className="pk-phase"
          data-state={current === null ? undefined : i < current ? "past" : i === current ? "current" : undefined}
          style={{ flexGrow: p.toWeek - p.fromWeek + 1 }}
          title={named ? p.name : undefined}
        >
          {named && <span className="pk-phase-name">{p.name}</span>}
        </div>
      ))}
    </div>
  );
}

/** Key numbers in tiles of two. */
export function StatTiles({ tiles }: { tiles: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="pk-stats">
      {tiles.map((t) => (
        <div key={t.label} className="pk-stat">
          <span className="pk-small">{t.label}</span>
          <b className="pk-stat-value">{t.value}</b>
          {t.sub && <span className="pk-small">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Changes in order, newest first, as a line of dots. */
export function Timeline({ items }: { items: { id: number; when: string; lines: string[] }[] }) {
  return (
    <ol className="pk-timeline">
      {items.map((e) => (
        <li key={e.id} className="pk-event">
          <span className="pk-small">{e.when}</span>
          {e.lines.map((line, i) => (
            <span key={i} className="pk-muted">
              {line}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** The one primary action, kept in view at the bottom while the screen scrolls. */
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="pk-sticky">{children}</div>;
}

/** A warning line, for demanding programs and test days. */
export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="pk-warn">
      <AlertTriangle size={15} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** How far through a multi-step screen the member is. */
export function StepBar({ at, of, label }: { at: number; of: number; label: string }) {
  return (
    <div className="pk-steps" role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={of} aria-valuenow={at + 1}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="pk-step" data-on={i <= at ? "true" : undefined} />
      ))}
    </div>
  );
}

/** Three numbers across: a small label, the number large and bold, an optional small line under. */
export function StatStrip({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="pk-strip">
      {items.map((it) => (
        <div key={it.label} className="pk-strip-item">
          <span className="pk-small">{it.label}</span>
          <b className="pk-strip-value">{it.value}</b>
          {it.sub && <span className="pk-small">{it.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** A session as a table: the exercise on the left, each set on its own line on the right. + sets are in the accent colour. */
export function SessionTable({ exercises, unit }: { exercises: PlannedExercise[]; unit: WeightUnit }) {
  return (
    <ul className="pk-table">
      {exercises.map((ex) => (
        <li key={`${ex.index}-${ex.name}`} className="pk-table-row">
          <span className="pk-table-name">
            {ex.name}
            {ex.joined && <span className="pk-small">Superset with the one above</span>}
          </span>
          <span className="pk-table-sets">
            {ex.sets.map((s, i) => (
              <span key={i} className={`pk-table-set${s.amrap || s.drives ? " pk-table-set--plus" : ""}`}>
                {setLine(s, unit)}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One quiet line: a label, an optional value, a chevron or plus. A link when it has an href. 44px tall, a hairline under it. */
export function QuietRow({ href, label, value, icon }: { href?: string; label: string; value?: string; icon?: "chevron" | "plus" }) {
  const inner = (
    <>
      <span>{label}</span>
      {(value || icon) && (
        <span className="pk-row-value">
          {value}
          {icon === "chevron" && <ChevronRight size={16} className="pk-chev" aria-hidden />}
          {icon === "plus" && <Plus size={16} className="pk-chev" aria-hidden />}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="pk-row pk-row--quiet">
      {inner}
    </Link>
  ) : (
    <div className="pk-row pk-row--quiet">{inner}</div>
  );
}

const CHART_W = 260;
const CHART_H = 120;
const AXIS_Y = CHART_H - 16;
const KIND_NOUN: Record<ChartKind, string> = { tm: "training max", weight: "working weight", top: "top set" };

/** Where a label sits beside its point: after it, or before it when that would run off the chart. */
function sideAt(x: number): { dx: number; anchor: "start" | "end" } {
  return x > CHART_W - 70 ? { dx: -6, anchor: "end" } : { dx: 6, anchor: "start" };
}

/**
 * One lift's path: a solid accent line for the value so far, a dashed line for
 * the plan from now to the end, the value now on the solid line and the planned
 * end value at the end of the dashed one. A training max reads to the nearest
 * 0.5 kg or 1 lb (formatMax, as My program writes it); a working weight or top
 * set is exact (formatWeight).
 */
export function PathChart({ chart, totalWeeks, firstWeek = 1, unit, kind }: { chart: LiftChart; totalWeeks: number; firstWeek?: number; unit: WeightUnit; kind: ChartKind }) {
  const fmt = (kg: number) => (kind === "tm" ? formatMax(kg, unit) : formatWeight(kg, unit));
  const g = pathGeometry(chart, totalWeeks, CHART_W, CHART_H, firstWeek);
  const { x, y } = chartScale(chart, totalWeeks, CHART_W, CHART_H, firstWeek);
  const now = chart.soFar.at(-1) ?? null;
  const end = chart.planned.at(-1) ?? null;
  const nowX = now ? x(now.week) : null;
  const endX = end ? x(end.week) : null;
  const close = nowX !== null && endX !== null && Math.abs(endX - nowX) < 56;
  // The line drops at "now" (a reset or a deload): the vertical is on the label's side, so the label goes under the dot.
  const prev = chart.soFar.at(-2);
  const next = chart.planned.find((p) => now && p.kg !== now.kg);
  const drops = !!now && ((!!prev && prev.kg > now.kg) || (!!next && next.kg < now.kg));
  // Close together, the two labels take opposite sides: the higher value above, the lower below.
  const nowBelow = drops || (close && !!now && !!end && end.kg >= now.kg);
  const endBelow = close && !nowBelow && !!now && !!end && end.kg < now.kg;
  const nowSide = nowX !== null ? sideAt(nowX) : null;
  const aria = `${chart.label} ${KIND_NOUN[kind]}: ${
    chart.nowKg === null && chart.endKg === null
      ? "no data yet"
      : [chart.nowKg !== null ? `${fmt(chart.nowKg)} now` : null, chart.endKg !== null && end ? `${fmt(chart.endKg)} planned by week ${end.week}` : null].filter(Boolean).join(", ")
  }`;
  return (
    <svg className="pk-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" role="img" aria-label={aria}>
      <line className="pk-chart-axis" x1={PAD.left} x2={CHART_W - PAD.right} y1={AXIS_Y} y2={AXIS_Y} />
      {g.planned && <polyline className="pk-chart-planned" points={g.planned} />}
      {g.soFar && <polyline className="pk-chart-solid" points={g.soFar} />}
      {now && nowX !== null && <circle className="pk-chart-dot" cx={nowX} cy={y(now.kg)} r={3.5} />}
      {now && nowX !== null && nowSide && (
        <text className="pk-chart-label pk-chart-label--strong" x={nowX + nowSide.dx} y={nowBelow ? y(now.kg) + 15 : y(now.kg) - 8} textAnchor={nowSide.anchor}>
          {fmt(now.kg)}
        </text>
      )}
      {end && endX !== null && (end.week !== now?.week || end.kg !== now?.kg) && (
        <text className="pk-chart-label" x={endX + sideAt(endX).dx} y={endBelow ? y(end.kg) + 15 : y(end.kg) - 8} textAnchor={sideAt(endX).anchor}>
          {fmt(end.kg)}
        </text>
      )}
      <text className="pk-chart-label pk-chart-label--weak" x={PAD.left} y={CHART_H - 2} textAnchor="start">
        Week 1
      </text>
      <text className="pk-chart-label pk-chart-label--weak" x={CHART_W - PAD.right} y={CHART_H - 2} textAnchor="end">
        {`Week ${Math.max(totalWeeks - Math.max(firstWeek, 1) + 1, 1)}`}
      </text>
    </svg>
  );
}
