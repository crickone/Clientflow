/** A tiny trend line for a list row. Needs two points to draw anything. */
export function Sparkline({ values, width = 64, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span style={{ width, height, display: "inline-block" }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`);
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ flexShrink: 0 }}>
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "var(--success)" : "var(--text-tertiary)"} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r={2.5} fill={up ? "var(--success)" : "var(--text-tertiary)"} />
    </svg>
  );
}
