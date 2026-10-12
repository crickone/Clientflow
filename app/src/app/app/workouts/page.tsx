import Link from "next/link";
import { ChevronRight, Dumbbell, History, Play, TrendingUp } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { assignedWorkoutPrograms } from "@/lib/clientApp";
import { listSessions, openSession, sessionSummary } from "@/lib/workoutLog";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { simple: "Simple", detailed: "Detailed", upload: "Document" };

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

export default async function ClientWorkoutsPage() {
  const { clientId } = requireClientPage();
  const programs = assignedWorkoutPrograms(clientId);
  const open = openSession(clientId);
  const recent = listSessions(clientId, 3);
  const openSum = open ? sessionSummary(open) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Your training programmes">Workouts</PageTitle>

      {open && openSum && (
        <Link href={`/app/workouts/log/${open.id}`}>
          <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <span style={{ ...iconBox, background: "var(--accent)", color: "#fff" }}><Play size={17} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>Continue {open.dayName}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {openSum.done} of {openSum.total} sets done · started {new Date(open.startedAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" })}
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          </Card>
        </Link>
      )}

      {programs.length === 0 ? (
        <Card><div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0" }}>No workout programme yet. Your coach will add one soon.</div></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {programs.map((p) => (
            <Link key={p.id} href={`/app/workouts/${p.id}`}>
              <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                <span style={iconBox}><Dumbbell size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{p.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{p.type === "detailed" ? "Pick a day to start" : TYPE_LABEL[p.type] ?? p.type}</div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Link href="/app/workouts/history">
          <Card style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
            <span style={{ color: "var(--accent-ink)" }}><History size={20} /></span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>History</span>
          </Card>
        </Link>
        <Link href="/app/workouts/progress">
          <Card style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
            <span style={{ color: "var(--accent-ink)" }}><TrendingUp size={20} /></span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>My lifts</span>
          </Card>
        </Link>
      </div>

      {recent.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          <SectionTitle>Recent workouts</SectionTitle>
          {recent.map((s) => {
            const sum = sessionSummary(s);
            return (
              <Link key={s.id} href={`/app/workouts/log/${s.id}`}>
                <Card style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{s.dayName}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{when(s.finishedAt!)}</div>
                  </div>
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {sum.done} sets{sum.volume > 0 ? ` · ${sum.volume.toLocaleString("en-IE")} kg` : ""}
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const iconBox: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)", flexShrink: 0 };
