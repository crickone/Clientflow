import Link from "next/link";
import { ChevronRight, Dumbbell, History, Play, TrendingUp } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { assignedWorkoutPrograms } from "@/lib/clientApp";
import { listSessions, sessionSummary } from "@/lib/workoutLog";
import { trainingOverview } from "@/lib/trainingOverview";
import { dateKey, WEEKDAY_SHORT } from "@/lib/trainingProgress";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { WeekStrip } from "@/components/clientapp/WeekStrip";
import { StartWorkoutButton } from "@/components/clientapp/StartWorkoutButton";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { simple: "Simple", detailed: "Detailed", upload: "Document" };

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

export default async function ClientWorkoutsPage() {
  const { clientId } = requireClientPage();
  const programs = assignedWorkoutPrograms(clientId);
  const t = trainingOverview(clientId);
  const recent = listSessions(clientId, 3);
  const today = dateKey(Date.now());
  const plannedToday = t.plan?.days.find((d) => d.date === today && d.status === "today");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Plan, log and track your training">Workouts</PageTitle>

      {t.open && (
        <Link href={`/app/workouts/log/${t.open.id}`}>
          <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <span style={{ ...iconBox, background: "var(--accent)", color: "#fff" }}><Play size={17} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>Continue {t.open.dayName}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {t.open.done} of {t.open.total} sets done
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          </Card>
        </Link>
      )}

      {t.plan && t.next && (
        <Card style={{ display: "grid", gap: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>This week</span>
            <Link href="/app/workouts/plan" style={{ fontSize: 13, color: "var(--accent-ink)", whiteSpace: "nowrap" }}>
              {t.plan.weekdays.length ? t.plan.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(", ") : "Set training days"}
            </Link>
          </div>
          <WeekStrip days={t.plan.days} todayKey={today} />
          {!t.open && (
            <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
              <div style={{ display: "grid", gap: 2 }}>
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{plannedToday ? "Today" : "Next up"}</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{t.next.dayName}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{t.next.programTitle}</span>
              </div>
              <StartWorkoutButton programId={t.next.programId} dayPosition={t.next.dayPosition} label={`Start ${t.next.dayName}`} />
            </div>
          )}
        </Card>
      )}

      {programs.length === 0 ? (
        <Card><div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0" }}>No programme yet. Your coach will add one, and you can log your own workouts in the meantime.</div></Card>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <SectionTitle>Your programmes</SectionTitle>
          {programs.map((p) => (
            <Link key={p.id} href={`/app/workouts/${p.id}`}>
              <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                <span style={iconBox}><Dumbbell size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{p.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{p.type === "detailed" ? "See every day" : TYPE_LABEL[p.type] ?? p.type}</div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              </Card>
            </Link>
          ))}
        </div>
      )}

      {!t.open && <StartWorkoutButton variant="secondary" label="Log your own workout" />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Link href="/app/progress">
          <Card style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
            <span style={{ color: "var(--accent-ink)" }}><TrendingUp size={20} /></span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>Progress</span>
          </Card>
        </Link>
        <Link href="/app/workouts/history">
          <Card style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
            <span style={{ color: "var(--accent-ink)" }}><History size={20} /></span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>History</span>
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
