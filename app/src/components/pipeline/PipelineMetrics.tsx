import type { BoardMetrics } from "@/lib/pipeline/boardMetrics";
import { Card } from "@/components/ui/Card";

/** Four funnel stat tiles above the board. Server component — pure render of computed metrics. */
export function PipelineMetrics({ metrics }: { metrics: BoardMetrics }) {
  const speed = fmtDuration(metrics.avgSpeedToLeadMs);
  const delta = metrics.newThisWeekDelta;
  const deltaLabel = delta === 0 ? "same as last week" : `${delta > 0 ? "+" : ""}${delta} vs last week`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 24 }}>
      <Tile label="New this week" value={String(metrics.newThisWeek)} sub={deltaLabel} />
      <Tile label="Avg speed to lead" value={speed} sub="last 30 days" />
      <Tile
        label="Uncontacted now"
        value={String(metrics.uncontactedNow)}
        sub={metrics.uncontactedBreaching ? "some waiting >1h" : "within SLA"}
        danger={metrics.uncontactedBreaching}
      />
      <Tile label="Lead → sale" value={metrics.conversionPct == null ? "—" : `${metrics.conversionPct}%`} sub="last 90 days" />
    </div>
  );
}

function Tile({ label, value, sub, danger = false }: { label: string; value: string; sub: string; danger?: boolean }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 6, color: danger ? "#dc2626" : "var(--text-primary)", fontFamily: "var(--font-heading), sans-serif" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>{sub}</div>
    </Card>
  );
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
