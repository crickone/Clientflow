import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatTime } from "@/lib/utils";

export interface ScheduleItem {
  id: number;
  startTime: string;
  status: string;
  clientName: string;
  therapies: { id: number; name: string; colourHex: string }[];
}

const FINISHED = new Set(["completed", "cancelled", "no_show"]);

/**
 * Today's diary in time order. The next booking still to come is picked out,
 * finished ones fade back, and an empty day says so in one line with a way
 * to book rather than a big zero.
 */
export function TodaysScheduleView({
  items,
  empty,
  nowHHMM,
  book,
}: {
  items: ScheduleItem[];
  empty: string;
  /** Current Irish time, "HH:MM", to find the next booking. */
  nowHHMM: string;
  book: { href: string; label: string };
}) {
  if (items.length === 0) {
    return (
      <div className="sched-empty">
        <div>
          <div className="sched-empty-title">{empty}</div>
          <div className="sched-empty-sub">Bookings you add appear here in time order.</div>
        </div>
        <Link href={book.href} className="btn btn--outline btn--md">
          {book.label}
        </Link>
      </div>
    );
  }
  const next = items.find((a) => !FINISHED.has(a.status) && a.startTime.slice(0, 5) >= nowHHMM);
  return (
    <div className="sched">
      {items.map((a) => {
        const cls = a.id === next?.id ? "sched-row sched-row--next" : FINISHED.has(a.status) ? "sched-row sched-row--done" : "sched-row";
        return (
          <Link key={a.id} href={`/appointments/${a.id}`} className={cls}>
            <span className="sched-time">{formatTime(a.startTime)}</span>
            <span className="sched-bar" aria-hidden />
            <span className="sched-who">
              <span className="sched-name">{a.clientName}</span>
              <span className="sched-what">
                {a.therapies.map((t) => (
                  <Badge key={t.id} colour={t.colourHex}>
                    {t.name}
                  </Badge>
                ))}
              </span>
            </span>
            {a.id === next?.id ? <span className="sched-next">Next</span> : <StatusBadge status={a.status} />}
          </Link>
        );
      })}
    </div>
  );
}
