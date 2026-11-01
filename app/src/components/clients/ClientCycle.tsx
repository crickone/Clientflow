import { Card, CardLabel } from "@/components/ui/Card";
import type { CoachCycle } from "@/lib/cycle";
import { DAY_FIELDS, DAY_SCALE, PHASE_LABEL, PHASE_NOTE, statusLine, type Phase } from "@/lib/cycleModel";
import { dayLabel } from "@/components/clientapp/ui";

const PHASES: Phase[] = ["period", "follicular", "mid", "luteal"];

/**
 * The coach's view of a member's cycle. Rendered only while the member shares
 * it (coachCycleView returns null otherwise), and says so, so staff know it
 * can disappear.
 */
export function ClientCycle({ view }: { view: CoachCycle }) {
  const s = view.status;
  const tracking = view.mode === "cycle";
  return (
    <>
      <p className="cp-origin" style={{ marginBottom: 12 }}>
        Shared by the member from their app. They can stop sharing or delete it at any time, and this tab goes with it.
      </p>
      <div className="bs-tiles" style={{ marginBottom: 16 }}>
        <div className="bs-tile">
          <span className="bs-tile-label">Today</span>
          <span className="bs-tile-value" style={{ fontSize: 18 }}>{tracking && s.phase ? PHASE_LABEL[s.phase] : tracking ? "No period logged" : "Check-ins only"}</span>
          {tracking && s.dayOfCycle !== null && <span className="bs-tile-label">{statusLine(s)}</span>}
        </div>
        <div className="bs-tile">
          <span className="bs-tile-label">Next period expected</span>
          <span className="bs-tile-value" style={{ fontSize: 18 }}>{tracking && s.nextStart ? dayLabel(s.nextStart, { weekday: "short", day: "numeric", month: "short" }) : "n/a"}</span>
          {tracking && s.nextStart && <span className="bs-tile-label">{s.cyclesKnown === 0 ? "Assumes 28 days until there is history" : `Average cycle ${s.cycleLength} days from ${s.cyclesKnown} cycle${s.cyclesKnown === 1 ? "" : "s"}`}</span>}
        </div>
        <div className="bs-tile">
          <span className="bs-tile-label">Check-ins, last 4 weeks</span>
          <span className="bs-tile-value">{view.recent.length}</span>
        </div>
      </div>

      <div className="wb-grid">
        {tracking && s.phase && (
          <Card className="cp-card">
            <CardLabel>Coaching this phase</CardLabel>
            <p className="cp-notes">{PHASE_NOTE[s.phase]}</p>
          </Card>
        )}

        <Card className="cp-card">
          <CardLabel>How they feel, by phase</CardLabel>
          {Object.values(view.byPhase).every((p) => p.days === 0) ? (
            <p className="cp-notes">No check-ins yet.</p>
          ) : (
            <table className="cy-phase-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  {DAY_FIELDS.map((f) => (
                    <th key={f}>{DAY_SCALE[f].label.replace("Cramps or pain", "Pain")}</th>
                  ))}
                  <th>Days</th>
                </tr>
              </thead>
              <tbody>
                {PHASES.filter((ph) => view.byPhase[ph].days > 0).map((ph) => (
                  <tr key={ph}>
                    <td>{PHASE_LABEL[ph]}</td>
                    {DAY_FIELDS.map((f) => (
                      <td key={f}>{view.byPhase[ph][f] === undefined ? "" : view.byPhase[ph][f]!.toFixed(1)}</td>
                    ))}
                    <td>{view.byPhase[ph].days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="cp-notes" style={{ marginTop: 8 }}>Scale 1 to 3. Energy, mood and sleep: 1 low, 3 high. Pain and cravings: 1 none, 3 a lot.</p>
        </Card>

        <Card className="cp-card">
          <CardLabel>Recent check-ins</CardLabel>
          {view.recent.length === 0 ? (
            <p className="cp-notes">Nothing in the last four weeks.</p>
          ) : (
            <dl className="cp-facts">
              {view.recent.slice(0, 14).map((l) => (
                <div key={l.day}>
                  <dt>{dayLabel(l.day)}</dt>
                  <dd>
                    {DAY_FIELDS.filter((f) => l[f] !== null)
                      .map((f) => `${DAY_SCALE[f].label.replace("Cramps or pain", "Pain")} ${DAY_SCALE[f].options[l[f]! - 1].toLowerCase()}`)
                      .join(", ") || "Note only"}
                    {l.note ? ` · ${l.note}` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        {tracking && view.periods.length > 0 && (
          <Card className="cp-card">
            <CardLabel>Periods logged</CardLabel>
            <dl className="cp-facts">
              {view.periods.map((p) => (
                <div key={p.id}>
                  <dt>{dayLabel(p.startDay)}</dt>
                  <dd>{p.endDay ? `to ${dayLabel(p.endDay)}` : s.onPeriod?.id === p.id ? "still on" : "no end logged"}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </div>
    </>
  );
}
