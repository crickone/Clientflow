import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import {
  addDaysIso,
  getWeekSessions,
  listBookableClients,
  todayIso,
  weekStartMonday,
} from "@/lib/timetable";
import { TimetableView } from "@/components/timetable/TimetableView";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { week?: string; view?: string; day?: string };
}

export default async function TimetablePage({ searchParams }: Props) {
  await requireUser();

  const today = todayIso();
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? "")
    ? weekStartMonday(searchParams.week!)
    : weekStartMonday(today);
  const view = searchParams.view === "day" ? "day" : "week";
  const dayIso = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? "")
    ? searchParams.day!
    : today;

  const sessions = getWeekSessions(weekStart);
  const clients = listBookableClients().map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
  }));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Programs"
        title="Timetable"
        subtitle="Group classes & sessions — schedule once, book clients in."
      />
      <TimetableView
        weekStart={weekStart}
        prevWeek={addDaysIso(weekStart, -7)}
        nextWeek={addDaysIso(weekStart, 7)}
        today={today}
        view={view}
        dayIso={dayIso}
        sessions={sessions}
        clients={clients}
      />
    </div>
  );
}
