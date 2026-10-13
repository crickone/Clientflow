import { Check } from "lucide-react";

import type { PlanDay } from "@/lib/trainingProgress";

const STATUS_TEXT: Record<PlanDay["status"], string> = {
  done: "trained",
  planned: "training day",
  today: "training today",
  missed: "missed",
  rest: "rest day",
};

/** This week, Monday to Sunday: trained, planned, today, missed or rest. */
export function WeekStrip({ days, todayKey }: { days: PlanDay[]; todayKey: string }) {
  return (
    <ol className="wk-strip" aria-label="This week">
      {days.map((d) => (
        <li key={d.date} className="wk-day" data-status={d.status} data-today={d.date === todayKey} aria-label={`${d.label}: ${STATUS_TEXT[d.status]}${d.title ? `, ${d.title}` : ""}`}>
          <span className="wk-label">{d.label.slice(0, 1)}</span>
          <span className="wk-dot">{d.status === "done" && <Check size={13} strokeWidth={3} />}</span>
        </li>
      ))}
    </ol>
  );
}
