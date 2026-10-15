/**
 * Four weeks of habit days as a grid of squares, Monday to Sunday, darker
 * the more was done. No hooks, so the client app and the staff page share it.
 */
export function HabitGrid({ days, today }: { days: { day: string; done: number; total: number }[]; today: string }) {
  // Pad the start so the first column is a Monday.
  const first = days[0]?.day;
  const pad = first ? (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells: ({ day: string; done: number; total: number } | null)[] = [...Array<null>(pad).fill(null), ...days];
  const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="hg" role="img" aria-label="Habits done each day over the last four weeks">
      <div className="hg-dows" aria-hidden>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="hg-grid">
        {cells.map((c, i) =>
          c ? (
            <span
              key={c.day}
              className="hg-cell"
              data-level={c.total === 0 ? 0 : c.done === 0 ? 0 : c.done === c.total ? 3 : c.done * 2 >= c.total ? 2 : 1}
              data-today={c.day === today}
              title={`${label(c.day)}: ${c.done} of ${c.total}`}
            />
          ) : (
            <span key={`p${i}`} className="hg-cell hg-cell--pad" />
          ),
        )}
      </div>
      <div className="hg-legend" aria-hidden>
        <span>None</span>
        <span className="hg-cell" data-level={0} />
        <span className="hg-cell" data-level={1} />
        <span className="hg-cell" data-level={2} />
        <span className="hg-cell" data-level={3} />
        <span>All done</span>
      </div>
    </div>
  );
}
