import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { memberCheckin } from "@/lib/checkins";
import { memberHabits } from "@/lib/habits";
import { HabitTicks } from "@/components/clientapp/HabitTicks";
import { PushSetup } from "@/components/clientapp/PushSetup";
import { getPrefs, vapidPublicKey } from "@/lib/push";
import { WEEKDAYS } from "@/lib/memberChoicesModel";

import { requireClientPage } from "@/lib/clientAuth";
import { MyProgramCard } from "@/components/clientapp/MyProgramCard";
import { PkCard, PkHeader, PkSection, QuietRow, StatStrip } from "@/components/clientapp/programs/kit";
import { liveStripItems } from "@/components/clientapp/programs/screenModel";
import { memberSeesPrograms } from "@/lib/programs/access";
import { liveEnrolment, programWeek } from "@/lib/programs/enrolments";
import { clientDashboard, clientUpcoming } from "@/lib/clientApp";
import { dayLabel, euros } from "@/components/clientapp/ui";
import { todayIso } from "@/lib/timetable";
import { dailyTarget, mealsForDay } from "@/lib/meals";
import { getManualBody, goalTarget } from "@/lib/goals";
import { memberCycle } from "@/lib/cycle";
import { PHASE_LABEL, statusLine } from "@/lib/cycleModel";
import { GOAL_BY_KEY } from "@/lib/goalsModel";
import { dayTotals, kcal } from "@/lib/mealsModel";
import { bodyScansEnabled, getScanProfile, listClientScans } from "@/lib/inbody/scans";
import { formatChange, formatMetric } from "@/lib/inbody/metrics";
import { trainingOverview } from "@/lib/trainingOverview";
import { dateKey, signed } from "@/lib/trainingProgress";
import { formatSet } from "@/lib/workoutLogModel";
import { StartWorkoutButton } from "@/components/clientapp/StartWorkoutButton";
import { openSession } from "@/lib/workoutLog";

export const dynamic = "force-dynamic";

function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

/** Home: one glance at your week. The full session table lives on Workouts. */
export default async function ClientHome() {
  const { clientId, client, tenantId } = requireClientPage();
  const programsVisible = memberSeesPrograms({ tenantId, client, clientId });
  const scansOn = bodyScansEnabled(tenantId);
  const scanConsent = scansOn ? getScanProfile(clientId).consentAt !== null : false;
  const scans = scanConsent ? listClientScans(clientId).filter((s) => Object.keys(s.metrics).length > 0) : [];
  const latestScan = scans[0];
  const firstScan = scans[scans.length - 1];
  const d = clientDashboard(clientId);
  const upcoming = clientUpcoming(clientId, 3);
  const t = trainingOverview(clientId);
  const today = dateKey(Date.now());
  const mealsToday = dayTotals(mealsForDay(clientId, today));
  const mealTarget = dailyTarget(clientId);
  const goal = goalTarget(clientId);
  const checkin = memberCheckin(clientId);
  const habits = memberHabits(clientId);
  const cycle = memberCycle(clientId);
  // The invite shows only where the member said they're female; the Profile page offers it to everyone.
  const inviteCycle = !cycle && getManualBody(clientId)?.sex === "female";
  const vapid = vapidPublicKey();
  const showTraining = t.programs.length > 0 || t.totalWorkouts > 0;
  const strengthNow = t.strength.length && t.lifts.some((l) => l.sessions > 1) ? t.strength[t.strength.length - 1].value : null;
  const muscle = latestScan && firstScan && latestScan !== firstScan ? formatChange("smm", latestScan.metrics.smm, firstScan.metrics.smm) : null;
  const fat = latestScan && firstScan && latestScan !== firstScan ? formatChange("pbf", latestScan.metrics.pbf, firstScan.metrics.pbf) : null;
  const showProgress = strengthNow !== null || muscle !== null || fat !== null;

  // A running DIY program leads; otherwise the coach's plan does (the same rule as Workouts).
  const view = programsVisible ? liveEnrolment(clientId) : null;
  const diy = view && view.status === "active" ? view : null;
  const weekDays = diy ? programWeek(diy) : t.plan?.days ?? null;
  const planned = weekDays ? weekDays.filter((x) => x.status !== "rest").length : 0;
  const done = weekDays ? weekDays.filter((x) => x.status === "done").length : 0;
  const thisWeek = t.weeks.at(-1)?.workouts ?? 0;
  const sessions = planned > 0 ? { value: `${done}/${planned}`, sub: "sessions" } : { value: String(thisWeek), sub: thisWeek === 1 ? "session" : "sessions" };
  // The program line already carries "Continue" for its own open workout, so its accent card would be a second one.
  const open = diy ? openSession(clientId) : null;
  const openIsProgram = !!diy && !!open && open.enrolmentId === diy.id;
  const next = d.nextClass;
  // A brand-new member has nothing to count yet: a number of 0 (or no class) is not shown, and with nothing left there is no strip.
  const stripItems = liveStripItems([
    { label: "This week", value: sessions.value, sub: sessions.sub },
    { label: "Streak", value: String(t.streak), sub: t.streak === 1 ? "week" : "weeks" },
    next ? { label: "Next class", value: next.date === todayIso() ? "Today" : dayLabel(next.date, { weekday: "short" }), sub: next.startTime } : null,
  ]);

  // The coach's plan row: not while a program leads or a workout is already open (its card is above).
  const showPlanRow = !diy && !t.open && !!t.next;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PkHeader crumb="Welcome back" title={client.firstName} />

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

      {stripItems.length > 0 && <StatStrip items={stripItems} />}

      {/* the one start button on the page: a running program, else the coach's next workout */}
      {diy ? (
        <MyProgramCard clientId={clientId} variant="line" />
      ) : showPlanRow && t.next ? (
        <div className="pk-row pk-row--quiet">
          <Link href="/app/workouts" className="pk-linkrow" style={{ flex: 1, minWidth: 0 }}>
            <span>{`Next up: ${t.next.dayName}`}</span>
          </Link>
          <StartWorkoutButton programId={t.next.programId} dayPosition={t.next.dayPosition} label="Start" compact />
        </div>
      ) : null}

      {/* daily habits */}
      {habits && (
        <PkCard>
          <Link href="/app/habits" className="pk-linkrow">
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <h2 className="pk-card-title">{habits.title}</h2>
              <span className="pk-small">Tick them off as you go</span>
            </div>
            <ChevronRight size={18} className="pk-chev" aria-hidden />
          </Link>
          <HabitTicks habits={habits.habits} ticked={[...habits.tickedToday]} day={habits.today} streak={habits.streak} compact />
        </PkCard>
      )}

      {/* weekly check-in: a card only while it is due */}
      {checkin?.due && (
        <PkCard href="/app/checkin" accent>
          <div className="pk-row">
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <h2 className="pk-card-title">Check-in due</h2>
              <span className="pk-small">{checkin.daysLate === 0 ? "Due today. Takes a couple of minutes." : `Due since ${WEEKDAYS[checkin.weekday - 1]}`}</span>
            </div>
            <ChevronRight size={18} className="pk-chev" aria-hidden />
          </div>
        </PkCard>
      )}

      <div>
        {checkin && !checkin.due && (
          <QuietRow
            href="/app/checkin"
            label="Check-in done"
            value={`Next ${new Date(`${checkin.next}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}`}
            icon="chevron"
          />
        )}

        <QuietRow
          href="/app/nutrition"
          label={mealsToday.calories > 0 ? `${kcal(mealsToday.calories)} today · ${mealsToday.protein} g protein` : "Log a meal"}
          value={mealsToday.calories > 0 && mealTarget ? `of ${kcal(mealTarget.calories)}` : undefined}
          icon={mealsToday.calories > 0 ? "chevron" : "plus"}
        />

        {next ? (
          <QuietRow href="/app/timetable" label={`${next.name}${next.instructor ? ` with ${next.instructor}` : ""}`} value={`${dayLabel(next.date, { weekday: "short", day: "numeric" })} · ${next.startTime}`} icon="chevron" />
        ) : (
          <QuietRow href="/app/timetable" label="No class booked" value="Browse the timetable" icon="chevron" />
        )}

        {d.weekBooked > 0 && (
          <QuietRow label="Classes this week" value={`${d.weekAttended} of ${d.weekBooked} attended`} />
        )}

        <QuietRow
          href="/app/membership"
          label={d.membership ? d.membership.name : "No active membership"}
          value={d.membership ? `${euros(d.membership.priceCents)} · ${d.membership.status}` : "Ask your coach"}
          icon="chevron"
        />

        {(cycle || inviteCycle) && (
          <QuietRow
            href="/app/cycle"
            label={
              cycle
                ? cycle.settings.mode === "cycle"
                  ? `${cycle.status.phase ? `Cycle: ${PHASE_LABEL[cycle.status.phase]}` : "Cycle"} · ${statusLine(cycle.status)}`
                  : `Cycle · ${cycle.todayLog.energy || cycle.todayLog.mood ? "Checked in today" : "How are you today?"}`
                : "Track your cycle"
            }
            icon="chevron"
          />
        )}

        <QuietRow
          href="/app/goal"
          label={goal ? `Goal: ${GOAL_BY_KEY[goal.goal.goal].label} · ${goal.target.protein} g protein` : "Set a goal"}
          value={goal ? `${goal.target.calories.toLocaleString("en-IE")} kcal` : undefined}
          icon="chevron"
        />

        {scansOn && (
          <QuietRow
            href="/app/body"
            label={latestScan ? `Body scans · ${formatMetric("smm", latestScan.metrics.smm)} muscle · ${formatMetric("pbf", latestScan.metrics.pbf)} body fat` : "Body scans"}
            value={latestScan ? formatMetric("weight", latestScan.metrics.weight) : undefined}
            icon="chevron"
          />
        )}

        {showProgress && (
          <QuietRow
            href="/app/progress"
            label="Your progress"
            value={strengthNow !== null ? `Strength ${signed(strengthNow, "%")}` : muscle ? `Muscle ${muscle.text}` : fat ? `Body fat ${fat.text}` : undefined}
            icon="chevron"
          />
        )}

        {showTraining && (
          <QuietRow href="/app/workouts" label={t.last ? `Last workout: ${t.last.dayName}, ${t.last.sets} sets` : "Workouts"} value={t.last ? shortDate(t.last.finishedAt) : undefined} icon="chevron" />
        )}
        {showTraining && t.latestBest && <QuietRow href="/app/progress" label={`Latest best: ${t.latestBest.name}`} value={formatSet(t.latestBest)} icon="chevron" />}
        {showTraining && !diy && t.plan && t.plan.weekdays.length === 0 && <QuietRow href="/app/workouts/plan" label="Pick your training days" icon="chevron" />}
      </div>

      {/* upcoming list: the first booking is the next-class row above */}
      {upcoming.length > 1 && (
        <PkSection label="Also booked">
          <div>
            {upcoming.slice(1).map((b) => (
              <QuietRow key={b.bookingId} href="/app/timetable" label={b.name} value={`${dayLabel(b.date, { weekday: "short", day: "numeric" })} · ${b.startTime}`} icon="chevron" />
            ))}
          </div>
        </PkSection>
      )}

      {/* reminders: shows only until notifications are on (or can't be) */}
      {vapid && <PushSetup vapidKey={vapid} prefs={getPrefs(clientId)} compact />}
    </div>
  );
}
