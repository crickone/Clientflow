/**
 * A bare sparkline: one path, no axes, no grid, no legend.
 *
 * The console's charts were full Recharts line charts with axes and gridlines
 * around series that are mostly flat zero — several hundred pixels of chrome
 * describing nothing. At this scale the shape of the line IS the whole message,
 * and the figure beside it carries the value, so everything else was noise.
 *
 * Refuses to draw a flat line: if every point is identical there is no trend to
 * show, and a dead-straight line reads as a broken chart. The caller renders
 * words instead.
 */
export function Sparkline({
  values,
  width = 132,
  height = 34,
  stroke = "url(#spark-metal)",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return null;

  const pad = 3;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const step = w / (values.length - 1);
  const y = (v: number) => pad + h - ((v - min) / (max - min)) * h;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const lastX = pad + (values.length - 1) * step;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: "block", overflow: "visible" }}>
      <defs>
        {/* The sculpture's metal, used as a stroke. One gradient, one place. */}
        <linearGradient id="spark-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#47596a" />
          <stop offset="0.55" stopColor="#8193a9" />
          <stop offset="1" stopColor="#f1f7ff" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* The present moment, marked. Everything left of it is history. */}
      <circle cx={lastX} cy={y(values[values.length - 1]!)} r={2.6} fill="#f1f7ff" />
    </svg>
  );
}

/**
 * A hairline bar showing one row's share of a total. Used in the fleet strip,
 * where the comparison that matters is between businesses, not against a scale.
 */
export function ShareBar({ fraction }: { fraction: number }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <span className="sharebar" aria-hidden>
      <span className="sharebar-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}
