"use client";

import { useId, useState } from "react";

import { niceTicks, scale } from "@/lib/chart";

/**
 * Inline SVG line chart. One accent series (the metal gradient already used
 * by the dashboard sparkline), the rest in grey. Axes, round ticks, and a
 * hover readout. Refuses to draw when every value is zero: a flat line
 * along nothing is a picture of nothing, so it says so instead.
 */
export function LineChart({
  title,
  series,
  labels,
  height = 180,
  format = (v) => String(v),
}: {
  title: string;
  series: { label: string; values: number[]; accent?: boolean }[];
  labels: string[];
  height?: number;
  format?: (v: number) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  if (max === 0) return <div className="chart chart--empty"><span className="chart-title">{title}</span><span>No movement yet.</span></div>;
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = scale(top, innerH);
  const x = (i: number) => (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * innerW);
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${pad.l + x(i)},${pad.t + innerH - y(v)}`).join(" ");

  return (
    <figure className="chart" aria-label={title}>
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-accent`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.5" stopColor="#9fb0c4" />
            <stop offset="1" stopColor="#f4f8ff" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH - y(t)} y2={pad.t + innerH - y(t)} className="chart-grid" />
            <text x={pad.l - 8} y={pad.t + innerH - y(t) + 3.5} className="chart-tick" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1) && (
          <text key={l + i} x={pad.l + x(i)} y={height - 8} className="chart-tick" textAnchor="middle">{l}</text>
        ))}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.accent ? `url(#${id}-accent)` : "rgba(244,245,247,0.28)"} strokeWidth={s.accent ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {labels.map((_, i) => (
          <rect key={i} x={pad.l + x(i) - innerW / labels.length / 2} y={pad.t} width={innerW / labels.length} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && (
          <g>
            <line x1={pad.l + x(hover)} x2={pad.l + x(hover)} y1={pad.t} y2={pad.t + innerH} className="chart-cursor" />
            {series.map((s) => (
              <circle key={s.label} cx={pad.l + x(hover)} cy={pad.t + innerH - y(s.values[hover] ?? 0)} r={3.5} fill={s.accent ? "#ffffff" : "rgba(244,245,247,0.6)"} />
            ))}
          </g>
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label} className={s.accent ? "is-accent" : undefined}>
            <i aria-hidden /> {s.label}
            {hover !== null && <strong> {format(s.values[hover] ?? 0)}</strong>}
          </span>
        ))}
        {hover !== null && <span className="chart-hover-label">{labels[hover]}</span>}
      </div>
    </figure>
  );
}
