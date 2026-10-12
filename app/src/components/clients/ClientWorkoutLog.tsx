import type { LiftRecord } from "@/lib/workoutLog";
import { durationLabel, formatSet, setsDone, volumeKg, type SessionView } from "@/lib/workoutLogModel";

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/** Staff view of what a member has logged in the app: best lifts, then each session set by set. */
export function ClientWorkoutLog({ sessions, records, open }: { sessions: SessionView[]; records: LiftRecord[]; open: SessionView | null }) {
  if (sessions.length === 0 && !open) {
    return (
      <div className="bs-empty">
        <p>No workouts logged yet.</p>
        <p className="bs-muted">When this member opens a programme day in the app and taps Start, their sets, weights and reps show here.</p>
      </div>
    );
  }
  const last = sessions[0];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const thisWeek = sessions.filter((s) => s.finishedAt! >= weekAgo).length;

  return (
    <div className="wlog">
      <div className="bs-tiles">
        <div className="bs-tile">
          <span className="bs-tile-label">Workouts logged</span>
          <span className="bs-tile-value">{sessions.length}</span>
        </div>
        <div className="bs-tile">
          <span className="bs-tile-label">Last 7 days</span>
          <span className="bs-tile-value">{thisWeek}</span>
        </div>
        <div className="bs-tile">
          <span className="bs-tile-label">Last workout</span>
          <span className="bs-tile-value" style={{ fontSize: 15 }}>{last ? day(last.finishedAt!) : "-"}</span>
        </div>
      </div>
      {open && (
        <p className="bs-muted" style={{ margin: 0 }}>
          In progress now: {open.dayName}, {setsDone(open.exercises).done} of {setsDone(open.exercises).total} sets ticked.
        </p>
      )}

      {records.length > 0 && (
        <div className="bs-history">
          <h3>Best lifts</h3>
          <div className="ib-table-wrap" style={{ margin: 0 }}>
            <table className="ib-table">
              <thead>
                <tr>
                  <th>Exercise</th>
                  <th>Best set</th>
                  <th>Est. 1 rep max</th>
                  <th>When</th>
                  <th>Times logged</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.exerciseKey}>
                    <td>{r.name}</td>
                    <td>{formatSet(r)}</td>
                    <td>{Math.round(r.e1rm * 2) / 2} kg</td>
                    <td>{day(r.at)}</td>
                    <td>{r.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="bs-history">
          <h3>Sessions</h3>
          <div className="wlog-sessions">
            {sessions.map((s) => {
              const c = setsDone(s.exercises);
              const vol = volumeKg(s.exercises);
              return (
                <details key={s.id} className="wlog-session">
                  <summary>
                    <span className="wlog-title">
                      {s.dayName} <span className="bs-muted">{s.programTitle}</span>
                    </span>
                    <span className="bs-muted">
                      {day(s.finishedAt!)} · {c.done} of {c.total} sets{vol > 0 ? ` · ${vol.toLocaleString("en-IE")} kg` : ""} · {durationLabel(s.finishedAt! - s.startedAt)}
                    </span>
                  </summary>
                  <div className="wlog-body">
                    {s.exercises.map((ex) => (
                      <div key={ex.id} className="wlog-ex">
                        <div className="wlog-ex-name">
                          {ex.name}
                          <span className="bs-muted">
                            {" "}
                            target {ex.targetSets} x {ex.targetReps ?? "-"}
                          </span>
                        </div>
                        <div className="wlog-sets">
                          {ex.sets.map((set, i) => (
                            <span key={i} className="wlog-set" data-done={set.done}>
                              {set.done ? formatSet(set) : "skipped"}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
