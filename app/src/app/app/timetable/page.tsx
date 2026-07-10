import { requireClientPage } from "@/lib/clientAuth";
import { clientMembership, clientWeek } from "@/lib/clientApp";
import { addDaysIso, todayIso } from "@/lib/timetable";
import { TimetableClient } from "@/components/clientapp/TimetableClient";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function ClientTimetablePage({ searchParams }: { searchParams: { week?: string } }) {
  const { clientId } = requireClientPage();
  const base = ISO.test(searchParams.week ?? "") ? searchParams.week! : todayIso();
  const { weekStart, classes } = clientWeek(clientId, base);
  const canBook = clientMembership(clientId) !== null;
  return (
    <TimetableClient
      weekStart={weekStart}
      today={todayIso()}
      prevWeek={addDaysIso(weekStart, -7)}
      nextWeek={addDaysIso(weekStart, 7)}
      classes={classes}
      canBook={canBook}
    />
  );
}
