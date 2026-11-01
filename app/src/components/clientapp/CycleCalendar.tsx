import type { CalendarMonth } from "@/lib/cycleModel";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/** Months of the cycle at a glance: period days filled, predicted days outlined, a dot on logged days. */
export function CycleCalendar({ months }: { months: CalendarMonth[] }) {
  return (
    <div className="cy-cal">
      {months.map((m) => (
        <div key={m.key} className="cy-month">
          <div className="cy-month-name">{m.label}</div>
          <div className="cy-grid" role="grid" aria-label={m.label}>
            {DOW.map((d, i) => (
              <span key={i} className="cy-dow" aria-hidden>
                {d}
              </span>
            ))}
            {Array.from({ length: m.offset }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {m.days.map((d) => (
              <span
                key={d.day}
                className="cy-day"
                data-period={d.period}
                data-predicted={d.predicted}
                data-today={d.today}
                data-future={d.future}
                title={d.period ? "Period" : d.predicted ? "Expected period" : undefined}
              >
                {d.n}
                {d.logged && <i className="cy-dot" aria-label="Checked in" />}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="cy-key">
        <span><i className="cy-swatch" data-kind="period" /> Period</span>
        <span><i className="cy-swatch" data-kind="predicted" /> Expected</span>
        <span><i className="cy-swatch" data-kind="logged" /> Checked in</span>
      </div>
    </div>
  );
}
