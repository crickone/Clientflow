import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { listSessions, sessionSummary } from "@/lib/workoutLog";
import { durationLabel } from "@/lib/workoutLogModel";
import { Card, PageTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

export default async function WorkoutHistoryPage() {
  const { clientId } = requireClientPage();
  const sessions = listSessions(clientId, 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={sessions.length ? `${sessions.length} workout${sessions.length === 1 ? "" : "s"} logged` : "Every workout you log"}>History</PageTitle>
      {sessions.length === 0 ? (
        <Card>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            No workouts logged yet. Open your programme, pick a day and tap Start workout.
          </div>
          <Link href="/app/workouts" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, color: "var(--accent-ink)", fontSize: 13.5 }}>
            Go to my workouts <ChevronRight size={15} />
          </Link>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map((s) => {
            const sum = sessionSummary(s);
            const lifts = s.exercises.filter((e) => e.sets.some((x) => x.done)).map((e) => e.name);
            return (
              <Link key={s.id} href={`/app/workouts/log/${s.id}`}>
                <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{s.dayName}</span>
                      <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>{when(s.finishedAt!)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      {sum.done} sets{sum.volume > 0 ? ` · ${sum.volume.toLocaleString("en-IE")} kg` : ""}
                      {sum.minutes !== null ? ` · ${durationLabel(s.finishedAt! - s.startedAt)}` : ""}
                    </div>
                    {lifts.length > 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lifts.join(", ")}</div>
                    )}
                  </div>
                  <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
