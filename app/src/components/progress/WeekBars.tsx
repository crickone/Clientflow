/**
 * One bar per week, oldest on the left, this week highlighted. Plain SVG, no
 * hooks, so it renders from server pages in the client app and the staff profile.
 */
export function WeekBars({
  weeks,
  height = 110,
  label,
}: {
  weeks: { weekStart: string; value: number }[];
  height?: number;
  /** Read out for screen readers, e.g. "Workouts each week". */
  label: string;
}) {
  if (weeks.length === 0) return null;
  const W = 320;
  const H = height;
  const pad = { t: 16, b: 20 };
  const max = Math.max(1, ...weeks.map((w) => w.value));
  const slot = W / weeks.length;
  const bw = Math.min(18, slot * 0.6);
  const fmt = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
  const last = weeks.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${label}: ${weeks.map((w) => w.value).join(", ")}`} style={{ display: "block", overflow: "visible" }}>
      <line x1={0} x2={W} y1={H - pad.b} y2={H - pad.b} stroke="var(--hairline)" />
      {weeks.map((w, i) => {
        const h = w.value > 0 ? Math.max(3, ((H - pad.t - pad.b) * w.value) / max) : 0;
        const x = i * slot + (slot - bw) / 2;
        return (
          <g key={w.weekStart}>
            {h > 0 ? (
              <rect x={x} y={H - pad.b - h} width={bw} height={h} rx={4} fill={i === last ? "var(--accent)" : "var(--accent-soft)"} stroke={i === last ? "none" : "var(--accent)"} strokeOpacity={0.35} />
            ) : (
              <rect x={x} y={H - pad.b - 2} width={bw} height={2} rx={1} fill="var(--hairline)" />
            )}
            {w.value > 0 && (i === last || w.value === max) && (
              <text x={x + bw / 2} y={H - pad.b - h - 5} fontSize="10" textAnchor="middle" fill="var(--text-secondary)">
                {w.value}
              </text>
            )}
          </g>
        );
      })}
      <text x={0} y={H - 5} fontSize="10" fill="var(--text-tertiary)">{fmt(weeks[0].weekStart)}</text>
      <text x={W} y={H - 5} fontSize="10" fill="var(--text-tertiary)" textAnchor="end">This week</text>
    </svg>
  );
}
