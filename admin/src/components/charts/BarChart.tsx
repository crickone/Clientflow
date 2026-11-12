"use client";

import { useState } from "react";

import { niceTicks, scale } from "@/lib/chart";

/**
 * Up (gains) above the line in the accent, down (losses) below in grey, a dot for net. For MRR movements.
 * `up` and `down` are both positive magnitudes (down is the size of the loss, not a negative number);
 * negative values are clamped to 0. `net` may be negative.
 */
export function BarChart({
  title,
  groups,
  height = 200,
  format = (v) => String(v),
}: {
  title: string;
  groups: { label: string; up: number; down: number; net: number }[];
  height?: number;
  format?: (v: number) => string;
}) {
  const safe = (v: number) => (Number.isFinite(v) ? v : 0);
  groups = groups.map((g) => ({ ...g, up: Math.max(0, safe(g.up)), down: Math.max(0, safe(g.down)), net: safe(g.net) }));
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const pad = { l: 50, r: 12, t: 12, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(0, ...groups.flatMap((g) => [g.up, g.down, Math.abs(g.net)]));
  if (max === 0) return <div className="chart chart--empty"><span className="chart-title">{title}</span><span>No movement yet.</span></div>;
  const top = niceTicks(max, 2).slice(-1)[0];
  const half = innerH / 2;
  const y = scale(top, half);
  const slot = innerW / groups.length;
  const last = groups[groups.length - 1];
  const summary = `${title}: latest month ${last.label} gained ${format(last.up)}, lost ${format(last.down)}, net ${format(last.net)}`;
  const bar = Math.min(28, slot * 0.5);
  const mid = pad.t + half;
  return (
    <figure className="chart" aria-label={title}>
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
        {[-top, -top / 2, 0, top / 2, top].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={mid - y(t)} y2={mid - y(t)} className={t === 0 ? "chart-axis" : "chart-grid"} />
            <text x={pad.l - 8} y={mid - y(t) + 3.5} className="chart-tick" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {groups.map((g, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={g.label} onMouseEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={innerH} fill="transparent" />
              <rect x={cx - bar / 2} y={mid - y(g.up)} width={bar} height={y(g.up)} fill="#9fb0c4" rx={2} />
              <rect x={cx - bar / 2} y={mid} width={bar} height={y(g.down)} fill="rgba(244,245,247,0.22)" rx={2} />
              <circle cx={cx} cy={mid - y(g.net)} r={3} fill="#ffffff" />
              <text x={cx} y={height - 8} className="chart-tick" textAnchor="middle">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="is-accent"><i aria-hidden /> Gained{hover !== null && <strong> {format(groups[hover].up)}</strong>}</span>
        <span><i aria-hidden /> Lost{hover !== null && <strong> {format(groups[hover].down)}</strong>}</span>
        <span>Net{hover !== null && <strong> {format(groups[hover].net)}</strong>}</span>
        {hover !== null && <span className="chart-hover-label">{groups[hover].label}</span>}
      </div>
    </figure>
  );
}
