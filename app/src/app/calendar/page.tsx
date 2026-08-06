import { PageHeader } from "@/components/layout/PageHeader";
import { requireUserPage } from "@/lib/auth";
import { listEventsInRange } from "@/lib/calendar";
import { CalendarView } from "@/components/calendar/CalendarView";

export const dynamic = "force-dynamic";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY = 86_400_000;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { m?: string };
}) {
  await requireUserPage();

  const todayIso = new Date().toISOString().slice(0, 10);
  const param = /^\d{4}-\d{2}$/.test(searchParams.m ?? "") ? searchParams.m! : todayIso.slice(0, 7);
  const [y, m] = param.split("-").map(Number); // m: 1-12

  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstWeekday = (first.getUTCDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(Date.UTC(y, m - 1, 1 - firstWeekday));
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getTime() + i * DAY);
    const iso = d.toISOString().slice(0, 10);
    return { date: iso, day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1, isToday: iso === todayIso };
  });

  const events = listEventsInRange(cells[0].date, cells[41].date);
  const prevMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        subtitle="Meetings, reminders and any events — separate from your client bookings."
      />
      <CalendarView
        label={`${MONTH_NAMES[m - 1]} ${y}`}
        prevMonth={prevMonth}
        nextMonth={nextMonth}
        thisMonth={todayIso.slice(0, 7)}
        today={todayIso}
        cells={cells}
        events={events}
      />
    </div>
  );
}
