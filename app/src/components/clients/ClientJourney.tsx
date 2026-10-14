import {
  ArrowRight,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  Euro,
  MessageCircle,
  Package as PackageIcon,
  Send,
  ShoppingBag,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { groupByDay, type JourneyEvent, type JourneyKind } from "@/lib/journeyModel";

const ICON: Record<JourneyKind, LucideIcon> = {
  "first-contact": UserPlus,
  stage: ArrowRight,
  "message-in": MessageCircle,
  "message-out": Send,
  purchase: ShoppingBag,
  payment: Euro,
  package: PackageIcon,
  booked: CalendarPlus,
  treatment: CheckCircle2,
  missed: CalendarX,
  client: UserCheck,
};

function dayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function time(ms: number) {
  return new Date(ms).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}

/** The client's whole history with the business as one timeline, oldest first. */
export function ClientJourney({ events }: { events: JourneyEvent[] }) {
  if (events.length === 0) {
    return <p className="cj-empty">Nothing recorded yet. Their first enquiry, bookings, payments and treatments will show here as they happen.</p>;
  }
  return (
    <ol className="cj">
      {groupByDay(events).map((g) => (
        <li key={g.day} className="cj-day">
          <h3 className="cj-date">{dayLabel(g.day)}</h3>
          <ol className="cj-events">
            {g.events.map((e, i) => {
              const Icon = ICON[e.kind];
              return (
                <li key={i} className="cj-event" data-kind={e.kind}>
                  <span className="cj-icon" aria-hidden>
                    <Icon size={14} />
                  </span>
                  <div className="cj-body">
                    <div className="cj-title">
                      {e.title}
                      <span className="cj-time">{time(e.at)}</span>
                    </div>
                    {e.detail && <div className="cj-detail">{e.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}
