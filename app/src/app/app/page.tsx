import { memberCheckin } from "@/lib/checkins";
import { memberHabits } from "@/lib/habits";
import { WEEKDAYS } from "@/lib/memberChoicesModel";

import { requireClientPage } from "@/lib/clientAuth";
import { QuietRow } from "@/components/clientapp/programs/kit";
import { HomeButtons } from "@/components/clientapp/home/HomeButtons";
import { HomeHero } from "@/components/clientapp/home/HomeHero";
import { HomeStrength } from "@/components/clientapp/home/HomeStrength";
import { HomeTiles } from "@/components/clientapp/home/HomeTiles";
import { clockLabel, dublinHour, featureButtons, greeting, heroChips, homeTiles, pickHero, roundTotal, strengthTrend } from "@/components/clientapp/home/homeModel";
import { memberSeesPrograms } from "@/lib/programs/access";
import { enrolmentCounts, liveEnrolment, planFor, programWeek } from "@/lib/programs/enrolments";
import { sessionCount, weekLabel } from "@/lib/programs/planner";
import { kgToUnit } from "@/lib/programs/units";
import { clientDashboard } from "@/lib/clientApp";
import { dayLabel } from "@/components/clientapp/ui";
import { todayIso } from "@/lib/timetable";
import { mealsForDay } from "@/lib/meals";
import { dayTotals } from "@/lib/mealsModel";
import { trainingOverview } from "@/lib/trainingOverview";
import { dateKey } from "@/lib/trainingProgress";
import { openSession } from "@/lib/workoutLog";

export const dynamic = "force-dynamic";

/** Home: today's session, four quick buttons and your strength. Membership, goal, body scans, cycle and notifications live on Profile. */
export default async function ClientHome() {
  const { clientId, client, tenantId } = requireClientPage();
  const programsVisible = memberSeesPrograms({ tenantId, client, clientId });
  const d = clientDashboard(clientId);
  const t = trainingOverview(clientId);
  const today = dateKey(Date.now());
  const mealsToday = dayTotals(mealsForDay(clientId, today));
  const checkin = memberCheckin(clientId);
  const habits = memberHabits(clientId);

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
          sessionsDone: enrolmentCounts(diy.id).done,
          roundTotal: roundTotal({ sessions: sessionCount(diy.template), lengthWeeks: diy.template.lengthWeeks, weeks: diy.template.weeks.length }),
        }
      : null,
    next: !diy && t.next ? { programId: t.next.programId, dayPosition: t.next.dayPosition, dayName: t.next.dayName } : null,
    programsVisible,
    paused: view?.status === "paused",
  });
  const nextWhen = next ? `${next.date === todayIso() ? "Today" : dayLabel(next.date, { weekday: "short" })} ${clockLabel(next.startTime)}` : null;
  const tiles = homeTiles({ week: { done, planned }, streak: t.streak });
  const buttons = featureButtons({
    proteinToday: mealsToday.protein,
    nextClass: next && nextWhen ? { name: next.name, when: nextWhen } : null,
    checkin: checkin
      ? {
          due: checkin.due,
          daysLate: checkin.daysLate,
          dueSince: WEEKDAYS[checkin.weekday - 1],
          next: new Date(`${checkin.next}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
        }
      : null,
    habits: habits ? { done: habits.tickedToday.size, total: habits.habits.length } : null,
  });
  const trend = strengthTrend(t.strength, t.lifts.filter((l) => l.sessions > 1).length);
  const dateLine = new Date(now).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" });

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header className="pk-greet">
        <div className="pk-greet-date">{dateLine}</div>
        <h1 className="pk-greet-title">{greeting(dublinHour(now), client.firstName)}</h1>
      </header>

      {hero && (
        <HomeHero
          hero={hero}
          unit={unit}
          openDetail={t.open ? `${t.open.done} of ${t.open.total} sets done` : undefined}
          blockLine={diy?.assignedBy ? "Block finished. Your coach will set what comes next." : "Program done. Enter your new max to run it again."}
        />
      )}

      <HomeTiles tiles={tiles} />

      <HomeButtons buttons={buttons} />

      <HomeStrength trend={trend} />

      {d.weekBooked > 0 && <QuietRow label="Classes this week" value={`${d.weekAttended} of ${d.weekBooked} attended`} />}
    </div>
  );
}
