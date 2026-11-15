// app/src/components/clientapp/programs/pathGeometry.ts
/**
 * The geometry behind the path chart: pure, no React, so it can be tested on
 * its own. kit.tsx draws it and re-exports pathGeometry.
 */
import type { LiftChart } from "@/lib/programs/progressData";

// The path chart. A fixed viewBox with room for a label above the highest point and one below the lowest, and the axis and week numbers under that.
export const PAD = { top: 24, right: 10, bottom: 34, left: 10 };

type Pt = { week: number; kg: number };

/** The scales for one chart: weeks across (the round's first week to the program's last week), kg up. Shared by the lines and the labels. */
export function chartScale(chart: LiftChart, totalWeeks: number, w: number, h: number, firstWeek = 1) {
  const all = [...chart.soFar, ...chart.planned];
  const kgs = all.map((p) => p.kg);
  const lo = kgs.length ? Math.min(...kgs) : 0;
  const hi = kgs.length ? Math.max(...kgs) : 0;
  const pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.02, 1);
  const yMin = lo - pad;
  const yMax = hi + pad;
  const first = Math.max(firstWeek, 1);
  const last = Math.max(totalWeeks, first);
  const span = Math.max(last - first, 1);
  const x = (week: number) => PAD.left + ((Math.min(Math.max(week, first), last) - first) / span) * (w - PAD.left - PAD.right);
  const y = (kg: number) => PAD.top + (1 - (kg - yMin) / (yMax - yMin)) * (h - PAD.top - PAD.bottom);
  return { x, y, yMin, yMax };
}

const n1 = (v: number) => String(Math.round(v * 10) / 10);

/** A step line: the value holds until the week it changes, then moves at once. */
function stepPoints(points: Pt[], x: (week: number) => number, y: (kg: number) => number): string {
  const out: string[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && prev.kg !== p.kg) out.push(`${n1(x(p.week))},${n1(y(prev.kg))}`);
    out.push(`${n1(x(p.week))},${n1(y(p.kg))}`);
  });
  return out.join(" ");
}

/** Pure geometry for PathChart, exported for tests: the two lines as SVG points strings, and the kg range they are drawn in. */
export function pathGeometry(chart: LiftChart, totalWeeks: number, w: number, h: number, firstWeek = 1): { soFar: string; planned: string; yMin: number; yMax: number } {
  const s = chartScale(chart, totalWeeks, w, h, firstWeek);
  return { soFar: stepPoints(chart.soFar, s.x, s.y), planned: stepPoints(chart.planned, s.x, s.y), yMin: s.yMin, yMax: s.yMax };
}
