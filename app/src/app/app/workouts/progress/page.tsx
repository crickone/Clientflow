import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { liftRecords } from "@/lib/workoutLog";
import { formatSet } from "@/lib/workoutLogModel";
import { Card, PageTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

export default async function LiftProgressPage() {
  const { clientId } = requireClientPage();
  const records = liftRecords(clientId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Your best set on each lift">My lifts</PageTitle>
      {records.length === 0 ? (
        <Card>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            Log a workout with weights and your best set on each lift will show here.
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {records.map((r) => (
            <Link key={r.exerciseKey} href={`/app/workouts/progress/${encodeURIComponent(r.exerciseKey)}`}>
              <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px" }}>
                <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{r.name}</span>
                  <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
                    {when(r.at)} · logged {r.sessions} time{r.sessions === 1 ? "" : "s"}
                  </span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatSet(r)}</span>
                <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
