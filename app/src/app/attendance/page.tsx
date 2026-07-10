import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { attendanceStats, clientActivity } from "@/lib/attendance";
import { addDaysIso, todayIso } from "@/lib/timetable";
import { AttendanceDashboard } from "@/components/attendance/AttendanceDashboard";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { range?: string; from?: string; to?: string };
}

const RANGES: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

export default async function AttendancePage({ searchParams }: Props) {
  await requireUser();

  const today = todayIso();
  const range = searchParams.range && (RANGES[searchParams.range] || searchParams.range === "ytd")
    ? searchParams.range
    : "30";

  let from: string;
  const to = today;
  if (range === "ytd") {
    from = `${today.slice(0, 4)}-01-01`;
  } else {
    from = addDaysIso(today, -(RANGES[range] - 1));
  }

  const stats = attendanceStats(from, to);
  const activity = clientActivity({ from, today });

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Programs"
        title="Attendance"
        subtitle="Bookings, check-ins and client engagement across your sessions."
      />
      <AttendanceDashboard
        range={range}
        from={from}
        to={to}
        today={today}
        stats={stats}
        activity={activity}
      />
    </div>
  );
}
