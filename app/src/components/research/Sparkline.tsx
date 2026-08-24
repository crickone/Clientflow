"use client";

import type { Metric } from "@/lib/research/store";

/**
 * Hand-rolled inline-SVG line chart — Market Research P1, Task 10. No chart
 * dep: this is the whole point of the brief's "tiny inline-SVG, no dep"
 * ask. Reused at two sizes: a fixed 60×20 glance mark inside CompetitorRow
 * (color defaults to the de-emphasis text-tertiary ink, no end dot — the
 * row already has a colored trend arrow, this is just shape context) and a
 * bigger, responsive, accent-colored chart with an area fill + end dot
 * inside CompetitorDetail.
 */

interface SparklineProps {
  /** Metric rows in the store's own newest-first order (see
   *  lib/research/store.ts's metricHistory doc comment) — reversed
   *  internally to plot chronologically, oldest first. */
  history: Metric[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  showEndDot?: boolean;
  showArea?: boolean;
  /** Stretches to fill the parent's width via viewBox scaling (the bigger
   *  detail chart); the tiny inline row sparkline stays a fixed pixel size. */
  responsive?: boolean;
  className?: string;
}

const PAD = 2;

export function Sparkline({
  history,
  width = 60,
  height = 20,
  color = "var(--text-tertiary)",
  strokeWidth = 1.5,
  showEndDot = false,
  showArea = false,
  responsive = false,
  className,
}: SparklineProps) {
  // Chronological (oldest -> newest) for plotting; ratingMilli is genuinely
  // optional (Google omits it for an unrated place — see places.ts), so an
  // unrated capture is dropped rather than fabricated as 0.
  const chronological = history.slice().reverse();
  const rated = chronological.filter(
    (m): m is Metric & { ratingMilli: number } => m.ratingMilli != null,
  );
  const values = rated.map((m) => m.ratingMilli / 1000);

  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;

  let linePath = "";
  let areaPath = "";
  let endPoint: [number, number] | null = null;

  if (values.length >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const points: [number, number][] = values.map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * innerW;
      // A flat series (range === 0, e.g. every capture so far is the same
      // rating) plots as a flat centre line rather than dividing by zero.
      const y = range === 0 ? PAD + innerH / 2 : PAD + innerH - ((v - min) / range) * innerH;
      return [x, y];
    });
    linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    if (showArea) {
      const baseline = height - PAD;
      const [firstX] = points[0];
      const [lastX] = points[points.length - 1];
      areaPath = `${linePath} L${lastX.toFixed(2)},${baseline.toFixed(2)} L${firstX.toFixed(2)},${baseline.toFixed(2)} Z`;
    }
    endPoint = points[points.length - 1];
  }

  const label =
    values.length >= 2
      ? `Rating trend: ${values[0].toFixed(1)} to ${values[values.length - 1].toFixed(1)} stars over ${values.length} captures`
      : "Not enough rating history yet";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={responsive ? undefined : width}
      height={height}
      preserveAspectRatio="none"
      style={responsive ? { width: "100%", height, display: "block" } : { display: "block", flexShrink: 0 }}
      className={className}
      role="img"
      aria-label={label}
    >
      {values.length < 2 ? (
        // Not enough history yet (0 or 1 rated captures) -- a flat, dashed,
        // neutral-hairline placeholder. Never a fabricated trend line: a
        // single point has no shape, so nothing is drawn as if it did.
        <line
          x1={PAD}
          y1={height / 2}
          x2={width - PAD}
          y2={height / 2}
          stroke="var(--hairline)"
          strokeWidth={1}
          strokeDasharray="2,2"
        />
      ) : (
        <>
          {showArea && areaPath && <path d={areaPath} fill={color} opacity={0.1} stroke="none" />}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {showEndDot && endPoint && (
            <circle cx={endPoint[0]} cy={endPoint[1]} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
          )}
        </>
      )}
    </svg>
  );
}
