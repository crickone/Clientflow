import { ChevronRight } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { MyProgramCard } from "@/components/clientapp/MyProgramCard";
import { PkCard, PkHeader, PkSection, QuietRow, StatStrip } from "@/components/clientapp/programs/kit";
import { liveStripItems, showsNoProgramRow } from "@/components/clientapp/programs/screenModel";
import { chartKind } from "@/lib/programs/progressSeries";
import { memberSeesPrograms } from "@/lib/programs/access";
import { liveEnrolment, programWeek } from "@/lib/programs/enrolments";
import { LIFT_LABEL } from "@/lib/programs/types";
import { formatMax } from "@/lib/programs/units";
import { assignedWorkoutPrograms } from "@/lib/clientApp";
import { listSessions, openSession, sessionSummary } from "@/lib/workoutLog";
import { trainingOverview } from "@/lib/trainingOverview";
import { dateKey, WEEKDAY_SHORT } from "@/lib/trainingProgress";
import { WeekStrip } from "@/components/clientapp/WeekStrip";
import { StartWorkoutButton } from "@/components/clientapp/StartWorkoutButton";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { simple: "Simple", detailed: "Detailed", upload: "Document" };

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

export default async function ClientWorkoutsPage() {
  const { clientId, client, tenantId } = requireClientPage();
  const programsVisible = memberSeesPrograms({ tenantId, client, clientId });
  const programs = assignedWorkoutPrograms(clientId);
  const t = trainingOverview(clientId);
  const recent = listSessions(clientId, 3);
  const today = dateKey(Date.now());
  const plannedToday = t.plan?.days.find((d) => d.date === today && d.status === "today");

  // A running DIY program leads; otherwise the coach's plan does.
  const view = programsVisible ? liveEnrolment(clientId) : null;
  const diy = view && view.status === "active" ? view : null;
  const open = diy ? openSession(clientId) : null;
  // The program card already carries "Continue session" for its own open workout.
  const openIsProgram = !!diy && !!open && open.enrolmentId === diy.id;

  const weekDays = diy ? programWeek(diy) : t.plan?.days ?? null;
  const planned = weekDays ? weekDays.filter((d) => d.status !== "rest").length : 0;
  const done = weekDays ? weekDays.filter((d) => d.status === "done").length : 0;
  const thisWeek = t.weeks.at(-1)?.workouts ?? 0;
  const sessions = planned > 0 ? { value: `${done}/${planned}`, sub: "sessions" } : { value: String(thisWeek), sub: thisWeek === 1 ? "session" : "sessions" };

  // The training max headline is only for programs that run on one; everything else counts workouts in the last 30 days.
  const lift = diy && chartKind(diy.template) === "tm" ? diy.template.lifts.find((l) => diy.state.tms[l] !== undefined) : undefined;
  const headline =
    diy && lift
      ? { label: `${LIFT_LABEL[lift]} TM`, value: formatMax(diy.state.tms[lift]!, diy.unit) }
      : { label: "Last 30 days", value: String(t.workouts30), sub: t.workouts30 === 1 ? "workout" : "workouts" };

  // A brand-new member has nothing to count yet: a 0 is not shown, and with nothing left there is no strip.
  const stripItems = liveStripItems([
    { label: "This week", value: sessions.value, sub: sessions.sub },
    headline,
    { label: "Streak", value: String(t.streak), sub: t.streak === 1 ? "week" : "weeks" },
  ]);

  const trainingDays = t.plan ? (t.plan.weekdays.length ? t.plan.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(", ") : "Set days") : null;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PkHeader title="Workouts" />

      {stripItems.length > 0 && <StatStrip items={stripItems} />}

      {weekDays && <WeekStrip days={weekDays} todayKey={today} />}

      {t.open && !openIsProgram && (
        <PkCard href={`/app/workouts/log/${t.open.id}`} accent>
          <div className="pk-row">
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <h2 className="pk-card-title">Continue {t.open.dayName}</h2>
              <span className="pk-small">
                {t.open.done} of {t.open.total} sets done
              </span>
            </div>
            <ChevronRight size={18} className="pk-chev" aria-hidden />
          </div>
        </PkCard>
      )}

      {diy ? (
        <MyProgramCard clientId={clientId} variant="full" />
      ) : t.plan && t.next && !t.open ? (
        <PkCard>
          <div className="pk-row">
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <span className="pk-small">{plannedToday ? "Today" : "Next up"}</span>
              <h2 className="pk-card-title">{t.next.dayName}</h2>
              <span className="pk-small">{t.next.programTitle}</span>
            </div>
          </div>
          <StartWorkoutButton programId={t.next.programId} dayPosition={t.next.dayPosition} label={`Start ${t.next.dayName}`} tall />
        </PkCard>
      ) : showsNoProgramRow({ coachPlan: !!t.plan, assignedPrograms: programs.length, enrolment: !!view }) ? (
        <QuietRow label="No program yet. Your coach can add one, or log your own." />
      ) : null}

      <div>
        {!t.open && <StartWorkoutButton variant="row" label="Log your own workout" />}
        <QuietRow href="/app/workouts/history" label="History" value={thisWeek > 0 ? `${thisWeek} this week` : undefined} icon="chevron" />
        <QuietRow href="/app/progress" label="Progress" icon="chevron" />
        {trainingDays && !diy && <QuietRow href="/app/workouts/plan" label="Training days" value={trainingDays} icon="chevron" />}
      </div>

      {programs.length > 0 && (
        <PkSection label="Your programs">
          <div>
            {programs.map((p) => (
              <QuietRow key={p.id} href={`/app/workouts/${p.id}`} label={p.title} value={p.type === "detailed" ? "See every day" : TYPE_LABEL[p.type] ?? p.type} icon="chevron" />
            ))}
          </div>
        </PkSection>
      )}

      {recent.length > 0 && (
        <PkSection label="Recent workouts">
          <div>
            {recent.map((s) => {
              const sum = sessionSummary(s);
              return <QuietRow key={s.id} href={`/app/workouts/log/${s.id}`} label={s.dayName} value={`${when(s.finishedAt!)} · ${sum.done} sets`} icon="chevron" />;
            })}
          </div>
        </PkSection>
      )}
    </div>
  );
}
