import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listBookings } from "@/lib/attendance";
import { addDaysIso, todayIso } from "@/lib/timetable";
import { BookingsTable } from "@/components/attendance/BookingsTable";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  searchParams: { from?: string; to?: string; status?: string; q?: string };
}

export default async function BookingsPage({ searchParams }: Props) {
  await requireUser();

  const today = todayIso();
  const to = ISO.test(searchParams.to ?? "") ? searchParams.to! : today;
  const from = ISO.test(searchParams.from ?? "") ? searchParams.from! : addDaysIso(to, -29);
  const status = searchParams.status ?? "all";

  const rows = listBookings({ from, to, status, q: searchParams.q, limit: 1000 });

  return (
    <div className="app-page">
      <Link
        href="/attendance"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: "var(--text-tertiary)",
          marginBottom: 8,
        }}
      >
        <ChevronLeft size={14} /> Attendance
      </Link>
      <PageHeader eyebrow="Programs" title="Bookings" subtitle="Every session booking, with check-in status." />
      <BookingsTable rows={rows} from={from} to={to} status={status} q={searchParams.q ?? ""} />
    </div>
  );
}
