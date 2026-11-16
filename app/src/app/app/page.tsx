import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { memberCheckin } from "@/lib/checkins";
import { memberHabits } from "@/lib/habits";
import { HabitTicks } from "@/components/clientapp/HabitTicks";
import { PushSetup } from "@/components/clientapp/PushSetup";
import { getPrefs, vapidPublicKey } from "@/lib/push";
import { WEEKDAYS } from "@/lib/memberChoicesModel";

import { requireClientPage } from "@/lib/clientAuth";
import { PkCard, PkSection, QuietRow } from "@/components/clientapp/programs/kit";
import { HomeHero } from "@/components/clientapp/home/HomeHero";
import { HomeTiles } from "@/components/clientapp/home/HomeTiles";
import { dublinHour, greeting, heroChips, homeTiles, pickHero } from "@/components/clientapp/home/homeModel";
import { memberSeesPrograms } from "@/lib/programs/access";
import { liveEnrolment, planFor, programWeek } from "@/lib/programs/enrolments";
import { weekLabel } from "@/lib/programs/planner";
import { kgToUnit } from "@/lib/programs/units";
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
  // Only one workout can be open at a time. The program's own open session is the hero's Continue; any other open workout is the hero instead.
  const open = diy ? openSession(clientId) : null;
  const openIsProgram = !!diy && !!open && open.enrolmentId === diy.id;
  const next = d.nextClass;

  const unit = diy?.unit ?? "kg";
  const plan = diy ? planFor(diy) : null;
  const now = Date.now();
  const hero = pickHero({
    open: t.open && !openIsProgram ? { id: t.open.id, dayName: t.open.dayName } : null,
    program: diy
      ? {
          plan: plan
            ? {
                dayName: plan.dayName,
                weekLabel: weekLabel(diy.template, diy.state),
                chips: heroChips(plan.exercises, (kg) => String(kgToUnit(kg, unit))),
                today: !!weekDays?.some((x) => x.status === "today" && x.title !== null),
              }
            : null,
          inProgress: openIsProgram,
        }
      : null,
    next: !diy && t.next ? { programId: t.next.programId, dayPosition: t.next.dayPosition, dayName: t.next.dayName } : null,
    programsVisible,
  });
  const tiles = homeTiles({
    protein: { got: mealsToday.protein, target: mealTarget?.protein ?? null },
    habits: habits ? { done: habits.tickedToday.size, total: habits.habits.length } : null,
    week: { done, planned },
    streak: t.streak,
    nextClass: next ? `${next.date === todayIso() ? "Today" : dayLabel(next.date, { weekday: "short" })} ${next.startTime}` : null,
  });
  const latestBestIsBest = !!t.latestBest && t.lifts.find((l) => l.name === t.latestBest!.name)?.best.at === t.latestBest.at;
  const dateLine = new Date(now).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" });

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header className="pk-greet">
        <div className="pk-greet-date">{dateLine}</div>
        <h1 className="pk-greet-title">{greeting(dublinHour(now), client.firstName)}</h1>
      </header>

      <HomeHero
        hero={hero}
        unit={unit}
        openDetail={t.open ? `${t.open.done} of ${t.open.total} sets done` : undefined}
        blockLine={diy?.assignedBy ? "Block finished. Your coach will set what comes next." : "Program done. Enter your new max to run it again."}
      />

      <HomeTiles tiles={tiles} />

      {/* what is next: the check-in when it is due, the next class, the latest best lift */}
      <PkSection label="Coming up">
        <div>
          {checkin?.due && (
            <QuietRow
              href="/app/checkin"
              label={checkin.daysLate === 0 ? "Weekly check-in" : `Check-in, due since ${WEEKDAYS[checkin.weekday - 1]}`}
              value="Due"
              icon="chevron"
            />
          )}
          {next ? (
            <QuietRow href="/app/timetable" label={`${next.name}${next.instructor ? ` with ${next.instructor}` : ""}`} value={`${dayLabel(next.date, { weekday: "short", day: "numeric" })} · ${next.startTime}`} icon="chevron" />
          ) : (
            <QuietRow href="/app/timetable" label="No class booked" value="Browse the timetable" icon="chevron" />
          )}
          {showTraining && t.latestBest && (
            <QuietRow
              href="/app/progress"
              label={`Latest best: ${t.latestBest.name}`}
              value={latestBestIsBest ? `${formatSet(t.latestBest)} · Best yet` : formatSet(t.latestBest)}
              icon="chevron"
            />
          )}
        </div>
      </PkSection>

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
