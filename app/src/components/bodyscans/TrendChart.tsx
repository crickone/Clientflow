import { formatMetric, METRIC_BY_KEY, type MetricKey } from "@/lib/inbody/metrics";

/**
 * One measurement over time, as a plain SVG line. No hooks and no chart
 * library, so it renders the same from the staff profile (server) and the
 * client app. Points are spaced by DATE, not by index: two scans a week apart
 * and two a month apart should not look the same.
 */
export function TrendChart({
  metric,
  points,
  height = 120,
}: {
  metric: MetricKey;
  points: { at: number; value: number }[];
  height?: number;
}) {
  const def = METRIC_BY_KEY[metric];
  const sorted = [...points].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return null;
  const W = 320;
  const H = height;
  const pad = { l: 6, r: 6, t: 14, b: 20 };
  const minV = Math.min(...sorted.map((p) => p.value));
  const maxV = Math.max(...sorted.map((p) => p.value));
  const span = maxV - minV || Math.max(1, Math.abs(maxV) * 0.05);
  const lo = minV - span * 0.15;
  const hi = maxV + span * 0.15;
  const t0 = sorted[0].at;
  const t1 = sorted[sorted.length - 1].at;
  const x = (t: number) => (t1 === t0 ? W / 2 : pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - pad.b} L${x(t0).toFixed(1)},${H - pad.b} Z`;
  const fmt = (t: number) => new Date(t).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
  const last = sorted[sorted.length - 1];
  const gradId = `tc-${metric}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${def.label} over time, latest ${formatMetric(metric, last.value)}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--hairline)" />
      {sorted.length > 1 && <path d={area} fill={`url(#${gradId})`} />}
      {sorted.length > 1 && <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {sorted.map((p) => (
        <circle key={p.at} cx={x(p.at)} cy={y(p.value)} r={p === last ? 4 : 2.5} fill={p === last ? "var(--accent)" : "var(--surface-1)"} stroke="var(--accent)" strokeWidth={1.5} />
      ))}
      <text x={pad.l} y={H - 5} fontSize="10" fill="var(--text-tertiary)">{fmt(t0)}</text>
      {sorted.length > 1 && (
        <text x={W - pad.r} y={H - 5} fontSize="10" fill="var(--text-tertiary)" textAnchor="end">{fmt(t1)}</text>
      )}
    </svg>
  );
}
