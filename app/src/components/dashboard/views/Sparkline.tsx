/**
 * A small trend line under a KPI. Server-rendered SVG: the line draws itself
 * in once (CSS, .spark-line) and the area under it is a flat wash so no
 * gradient id has to be unique per tile.
 */
export function Sparkline({ points, height = 34 }: { points: number[]; height?: number }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const w = 100;
  const pad = 2;
  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    // A flat series sits low rather than floating mid-tile.
    const y = max === min ? height - pad : pad + (1 - (p - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  const flat = max === 0;
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      aria-hidden
      style={{ display: "block", marginTop: 14, overflow: "visible" }}
    >
      {!flat && <path d={area} className="spark-area" />}
      <path d={line} pathLength={1} className={flat ? "spark-line spark-line--flat" : "spark-line"} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
