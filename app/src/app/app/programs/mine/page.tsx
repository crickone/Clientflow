// app/src/app/app/programs/mine/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Pause, Pencil } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { actorLabel } from "@/lib/programs/cards";
import { enrolmentEvents, liveEnrolment, planFor, programWeek, sessionTitle } from "@/lib/programs/enrolments";
import { parseMemberKey } from "@/lib/programs/memberTemplate";
import { summarisePlanned, weekLabel } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
import { formatWeight } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { openSession } from "@/lib/workoutLog";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { WeekStrip } from "@/components/clientapp/WeekStrip";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";
import { MyProgramControls } from "@/components/clientapp/MyProgramControls";
import { RestartProgramForm } from "@/components/clientapp/RestartProgramForm";
import { OwnMaxForm } from "@/components/clientapp/OwnMaxForm";

export const dynamic = "force-dynamic";

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

export default async function MyProgramPage() {
  const { clientId } = requireProgramsPage();
  const view = liveEnrolment(clientId);
  if (!view) redirect("/app/programs");
  const t = view.template;
  const plan = view.status === "active" ? planFor(view) : null;
  const open = openSession(clientId);
  const inProgress = !!open && open.enrolmentId === view.id;
  const events = enrolmentEvents(view.id, 30);
  const today = dateKey(Date.now());
  const fmt = (kg: number) => formatWeight(kg, view.unit);
  // One of the member's own programs: they can edit it and set its maxes.
  const ownId = view.programKey ? parseMemberKey(view.programKey) : null;
  const startsLater = view.startDate > today ? `. Starts ${new Date(`${view.startDate}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={`${weekLabel(t, view.state)}${startsLater}`}>{t.name}</PageTitle>

      {ownId !== null && (
        <Link href={`/app/programs/built/${ownId}`} className="bld-link">
          <Pencil size={16} aria-hidden /> Edit program
        </Link>
      )}

      {view.status === "paused" && (
        <Card style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Pause size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>Paused while you&rsquo;re coach guided. Nothing is lost.</span>
        </Card>
      )}

      {plan && (
        <Card style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{inProgress ? "In progress" : "Next session"}</div>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text-primary)" }}>{sessionTitle(view, plan)}</div>
          {plan.test && (
            <div className="pg-warning">
              <AlertTriangle size={14} aria-hidden />
              <span>Test day. Work up to a new max with a spotter or safety bars.</span>
            </div>
          )}
          {plan.exercises.map((ex) => (
            <div key={ex.index} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-primary)" }}>{ex.name}</span> {summarisePlanned(ex.sets, view.unit)}
            </div>
          ))}
          <StartProgramSessionButton label={inProgress ? "Continue session" : "Start session"} />
        </Card>
      )}

      {view.status === "active" && view.state.finished && (
        <Card style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text-primary)" }}>Program done</div>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>Enter your new max to run it again, or end it and pick another.</div>
          <RestartProgramForm unit={view.unit} lifts={t.lifts.map((l) => ({ lift: l, label: LIFT_LABEL[l], suggestionKg: view.state.testMaxes[l] ?? view.state.maxes[l] ?? null }))} />
        </Card>
      )}

      {view.status === "active" && !view.state.finished && (
        <Card style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>This week</div>
          <WeekStrip days={programWeek(view)} todayKey={today} />
        </Card>
      )}

      {t.lifts.length > 0 && (
        <Card style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Your maxes</div>
          {t.lifts.map((l) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5 }}>
              <span style={{ color: "var(--text-secondary)" }}>{LIFT_LABEL[l]}</span>
              <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                {view.state.maxes[l] !== undefined ? fmt(view.state.maxes[l]!) : "-"}
                {t.tmPct !== 1 && view.state.tms[l] !== undefined ? `, training max ${fmt(view.state.tms[l]!)}` : ""}
              </span>
            </div>
          ))}
          {ownId !== null && <OwnMaxForm unit={view.unit} lifts={t.lifts} />}
        </Card>
      )}

      {view.status === "active" && <MyProgramControls canSkip={!!plan} weekdays={view.weekdays} />}

      <SectionTitle>Changes</SectionTitle>
      {events.map((e) => (
        <Card key={e.id} style={{ display: "grid", gap: 4, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            {when(e.at)}, {actorLabel(e.actor, e.actorName, true)}
          </div>
          {e.reason.split("\n").map((line, i) => (
            <div key={i} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              {line}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
