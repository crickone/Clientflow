import type { PreviewWeek } from "@/lib/programs/preview";

/** Week by week: what the program prescribes, and what that is for a lifter whose maxes are 100 kg. */
export function ProgramPreviewTable({ weeks }: { weeks: PreviewWeek[] }) {
  return (
    <div className="pv">
      {weeks.map((w) => (
        <section key={w.label} className="pv-week">
          <h3 className="pv-week-title">{w.label}</h3>
          <div className="pv-table" role="table" aria-label={w.label}>
            <div className="pv-row pv-row--head" role="row">
              <span role="columnheader">Day</span>
              <span role="columnheader">Exercise</span>
              <span role="columnheader">Prescribed</span>
              <span role="columnheader">For a 100 kg lifter</span>
            </div>
            {w.rows.map((r, i) => (
              <div key={i} className="pv-row" role="row" data-test={r.test}>
                <span role="cell">{i === 0 || w.rows[i - 1].day !== r.day ? r.day : ""}</span>
                <span role="cell">{r.exercise}</span>
                <span role="cell">{r.rx}</span>
                <span role="cell">{r.example}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
