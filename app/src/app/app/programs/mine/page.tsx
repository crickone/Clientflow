// app/src/app/app/programs/mine/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pause, Pencil } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { actorLabel } from "@/lib/programs/cards";
import { currentPhase, programContent, withContentFrom } from "@/lib/programs/content";
import { isFullBlock } from "@/lib/programs/editing";
import { enrolmentCounts, enrolmentEvents, liveEnrolment, planFor, programWeek, sessionTitle } from "@/lib/programs/enrolments";
import { copyKey, programByKey } from "@/lib/programs/library";
import { memberKey, parseMemberKey } from "@/lib/programs/memberTemplate";
import { weightWhy } from "@/lib/programs/outline";
import { sessionCount, summarisePlanned, weekLabel } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
import { formatWeight } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { openSession } from "@/lib/workoutLog";
import { PhaseBar, PkCard, PkHeader, PkSection, StatTiles, Timeline, Warn } from "@/components/clientapp/programs/kit";
import { WeekStrip } from "@/components/clientapp/WeekStrip";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";
import { MyProgramControls } from "@/components/clientapp/MyProgramControls";
import { RestartProgramForm } from "@/components/clientapp/RestartProgramForm";
import { OwnMaxForm } from "@/components/clientapp/OwnMaxForm";

export const dynamic = "force-dynamic";

/** How many changes the timeline shows. */
const RECENT = 10;

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

/** My program (direction A, today first): where the member is, the next session with its weights and why, key numbers, recent changes, then the controls. */
export default async function MyProgramPage() {
  const { clientId } = requireProgramsPage();
  const view = liveEnrolment(clientId);
  if (!view) redirect("/app/programs");
  const t = view.template;
  // One of the member's own programs: they can edit it and set its maxes.
  const ownId = view.programKey ? parseMemberKey(view.programKey) : null;
  // The library entry it came from, for content a snapshot taken before programs had it, and for the link to the program page.
  const source = ownId !== null ? null : view.copyId !== null ? programByKey(copyKey(view.copyId)) : view.programKey ? programByKey(view.programKey, { includeHidden: true }) : null;
  const content =
    ownId !== null
      ? programContent(t, { kind: "member" })
      : programContent(withContentFrom(t, source?.template ?? null), source && source.copyId !== null ? { kind: "copy", basedOnName: source.basedOnName ?? t.name } : { kind: "platform" });
  const programHref =
    ownId !== null ? `/app/programs/${encodeURIComponent(memberKey(ownId))}` : source && !source.hidden ? `/app/programs/${encodeURIComponent(source.template.key)}` : null;

  const active = view.status === "active";
  const plan = active ? planFor(view) : null;
  const day = t.weeks[view.state.week]?.days[view.state.day];
  const open = openSession(clientId);
  const inProgress = !!open && open.enrolmentId === view.id;
  const events = enrolmentEvents(view.id, RECENT);
  const counts = enrolmentCounts(view.id);
  const today = dateKey(Date.now());
  const week = active && !view.state.finished ? programWeek(view) : [];
  const next = week.find((d) => d.status === "today" || d.status === "planned");
  const fmt = (kg: number) => formatWeight(kg, view.unit);
  const phase = view.state.finished ? null : currentPhase(content, t, view.state);
  const startsLater = view.startDate > today ? ` · Starts ${new Date(`${view.startDate}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : "";
  const where = view.state.finished ? "Program done" : `${weekLabel(t, view.state)}${phase !== null ? ` · ${content.phases[phase].name}` : ""}${startsLater}`;

  return (
    <div className="pk">
      <PkHeader title={t.name} lead={where}>
        <PhaseBar phases={content.phases} current={phase} />
      </PkHeader>

      {view.status === "paused" && (
        <PkCard>
          <div className="pk-row">
            <span className="pk-muted">Paused while you&rsquo;re coach guided. Nothing is lost.</span>
            <Pause size={18} aria-hidden className="pk-chev" />
          </div>
        </PkCard>
      )}

      {plan && (
        <PkCard accent>
          <span className="pk-small">{inProgress ? "In progress" : next ? `Next session · ${next.status === "today" ? "Today" : next.label}` : "Next session"}</span>
          <h2 className="pk-card-title">{sessionTitle(view, plan)}</h2>
          {plan.test && <Warn>Test day. Work up to a new max with a spotter or safety bars.</Warn>}
          {plan.exercises.map((ex) => {
            const why = weightWhy(ex, day?.exercises[ex.index], t.tmPct, view.unit);
            return (
              <div key={ex.index}>
                <div className="pk-line">
                  <span>{ex.name}</span>
                  <span>{summarisePlanned(ex.sets, view.unit)}</span>
                </div>
                {why && <span className="pk-small">{why}</span>}
              </div>
            );
          })}
          <StartProgramSessionButton label={inProgress ? "Continue session" : "Start session"} />
        </PkCard>
      )}

      {active && view.state.finished && (
        <PkCard>
          <h2 className="pk-card-title">Program done</h2>
          <span className="pk-muted">Enter your new max to run it again, or end it and pick another.</span>
          <RestartProgramForm unit={view.unit} lifts={t.lifts.map((l) => ({ lift: l, label: LIFT_LABEL[l], suggestionKg: view.state.testMaxes[l] ?? view.state.maxes[l] ?? null }))} />
        </PkCard>
      )}

      <PkSection label="Your numbers">
        <StatTiles
          tiles={[
            ...t.lifts.map((l) => ({
              label: `${LIFT_LABEL[l]} max`,
              value: view.state.maxes[l] !== undefined ? fmt(view.state.maxes[l]!) : "-",
              sub: t.tmPct !== 1 && view.state.tms[l] !== undefined ? `Training max ${fmt(view.state.tms[l]!)}` : undefined,
            })),
            {
              label: "Sessions",
              value: isFullBlock(t) ? `${counts.done} of ${sessionCount(t)}` : `${counts.done} done`,
              sub: counts.skipped === 0 ? "None skipped" : `${counts.skipped} skipped`,
            },
          ]}
        />
      </PkSection>

      {week.length > 0 && (
        <PkSection label="This week">
          <WeekStrip days={week} todayKey={today} />
        </PkSection>
      )}

      {events.length > 0 && (
        <PkSection label="Recent changes">
          <Timeline items={events.map((e) => ({ id: e.id, when: `${when(e.at)}, ${actorLabel(e.actor, e.actorName, true)}`, lines: e.reason.split("\n") }))} />
        </PkSection>
      )}

      {programHref && (
        <Link href={programHref} className="pk-btn">
          See the whole program
        </Link>
      )}

      <PkSection label="Your program">
        {ownId !== null && (
          <Link href={`/app/programs/built/${ownId}`} className="pk-ghost">
            <Pencil size={16} aria-hidden /> Edit program
          </Link>
        )}
        {active && <MyProgramControls canSkip={!!plan} weekdays={view.weekdays} />}
        {ownId !== null && t.lifts.length > 0 && <OwnMaxForm unit={view.unit} lifts={t.lifts} />}
      </PkSection>
    </div>
  );
}
