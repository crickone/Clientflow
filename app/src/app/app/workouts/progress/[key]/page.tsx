import { notFound } from "next/navigation";

import { requireClientPage } from "@/lib/clientAuth";
import { liftProgress } from "@/lib/workoutLog";
import { formatKg, formatSet } from "@/lib/workoutLogModel";
import { liftChange, signed } from "@/lib/trainingProgress";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { TrendChart } from "@/components/bodyscans/TrendChart";

export const dynamic = "force-dynamic";

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

export default async function LiftDetailPage({ params }: { params: { key: string } }) {
  const { clientId } = requireClientPage();
  const lift = liftProgress(clientId, decodeURIComponent(params.key));
  if (!lift || lift.points.length === 0) notFound();
  const best = lift.points.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));
  const latest = lift.points[lift.points.length - 1];
  const change = liftChange(lift.points);
  const round = (n: number) => Math.round(n * 2) / 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={`Best ${formatSet(best)} on ${when(best.at)}`}>{lift.name}</PageTitle>
      {lift.points.length > 1 && change && (
        <Card style={{ padding: "14px 14px 10px", display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>Estimated one-rep max</span>
            <span style={{ fontSize: 13, color: change.kg > 0 ? "var(--success)" : "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
              {signed(change.kg, " kg")} ({signed(change.pct, "%")})
            </span>
          </div>
          <TrendChart label="Estimated one-rep max" unit="kg" points={lift.points.map((p) => ({ at: p.at, value: round(p.e1rm) }))} height={120} />
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-tertiary)" }}>
            Worked out from your best set each session, so more reps at the same weight counts as getting stronger. Latest {formatKg(round(latest.e1rm))}.
          </div>
        </Card>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        <SectionTitle>Best set each session</SectionTitle>
        {[...lift.points].reverse().map((p) => (
          <Card key={p.at} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{when(p.at)}</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: p === best ? "var(--accent-ink)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatSet(p)}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}
