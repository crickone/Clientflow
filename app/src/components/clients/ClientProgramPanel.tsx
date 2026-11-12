// app/src/components/clients/ClientProgramPanel.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { coachMoveWeekAction, coachSetMaxAction } from "@/app/clients/[id]/programActions";
import { PANEL_EVENT_LIMIT, type ProgramPanelData } from "@/lib/programs/panel";

/** Staff view of a member's DIY program: where they are, their maxes, the next session, and every change with its reason. */
export function ClientProgramPanel({ clientId, data }: { clientId: number; data: ProgramPanelData }) {
  const router = useRouter();
  const live = data.live;
  const [lift, setLift] = useState(live?.lifts[0]?.lift ?? "squat");
  const [value, setValue] = useState("");
  const [weekIndex, setWeekIndex] = useState(live?.currentWeek ?? 0);
  const [maxPending, startMax] = useTransition();
  const [weekPending, startWeek] = useTransition();
  // After a move or a finished session the page refreshes with a new week: follow it.
  const currentWeek = live?.currentWeek ?? 0;
  useEffect(() => setWeekIndex(currentWeek), [currentWeek]);

  function saveMax(e: React.FormEvent) {
    e.preventDefault();
    if (!live) return;
    startMax(async () => {
      const r = await coachSetMaxAction(clientId, live.enrolmentId, lift, Number(value.replace(",", ".")));
      if (!r.ok) return void toast.error(r.error);
      toast.success("Max saved.");
      setValue("");
      router.refresh();
    });
  }

  function moveWeek(e: React.FormEvent) {
    e.preventDefault();
    if (!live) return;
    startWeek(async () => {
      const r = await coachMoveWeekAction(clientId, live.enrolmentId, weekIndex);
      if (!r.ok) return void toast.error(r.error);
      const to = live.weeks.find((w) => w.index === weekIndex);
      toast.success(to ? `Moved to week ${to.number}.` : "Moved.");
      router.refresh();
    });
  }

  return (
    <section className="dp" aria-label="DIY program">
      {live ? (
        <>
          <div className="dp-head">
            <div>
              <div className="dp-eyebrow">DIY program</div>
              <h3 className="dp-title">{live.name}</h3>
              <p className="dp-sub">{live.byline}</p>
            </div>
            <span className="dp-status" data-status={live.status}>
              {live.status === "paused" ? "Paused" : live.finished ? "Finished" : "Active"}
            </span>
          </div>

          <div className="dp-tiles">
            <div className="dp-tile">
              <span className="dp-tile-label">Where they are</span>
              <span className="dp-tile-value">{live.weekLine}</span>
            </div>
            {live.lifts.map((l) => (
              <div key={l.lift} className="dp-tile">
                <span className="dp-tile-label">{l.label} max</span>
                <span className="dp-tile-value">{l.max}</span>
                {l.tm && <span className="dp-tile-label">Training max {l.tm}</span>}
              </div>
            ))}
          </div>

          {live.next && (
            <div className="dp-card">
              <div className="dp-card-title">Next session: {live.next.title}</div>
              {live.next.lines.map((line) => (
                <div key={line} className="dp-line">
                  {line}
                </div>
              ))}
            </div>
          )}

          {(live.lifts.length > 0 || live.weeks.length > 1) && (
            <div className="dp-forms">
              {live.lifts.length > 0 && (
                <form className="dp-form" onSubmit={saveMax}>
                  <select value={lift} onChange={(e) => setLift(e.target.value as typeof lift)} aria-label="Lift">
                    {live.lifts.map((l) => (
                      <option key={l.lift} value={l.lift}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`New max in ${live.unit}`} style={{ width: 150 }} />
                  <Button type="submit" variant="secondary" loading={maxPending} disabled={!value.trim()}>
                    Correct max
                  </Button>
                </form>
              )}
              {/* A single repeating week (PPL, Arnold, GVT) has nowhere to move to. */}
              {live.weeks.length > 1 && (
                <form className="dp-form" onSubmit={moveWeek}>
                  <select value={weekIndex} onChange={(e) => setWeekIndex(Number(e.target.value))} aria-label="Week">
                    {live.weeks.map((w) => (
                      <option key={w.index} value={w.index}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="secondary" loading={weekPending}>
                    Move to this week
                  </Button>
                </form>
              )}
            </div>
          )}

          <div className="dp-card">
            <div className="dp-card-title">Recent skips</div>
            {live.skipped.length === 0 && <div className="dp-line">No skips in the latest changes.</div>}
            {live.skipped.map((s, i) => (
              <div key={i} className="dp-line">
                {s.when}: {s.text}
              </div>
            ))}
          </div>

          <div className="dp-card">
            <div className="dp-card-title">Change log</div>
            {live.events.length === 0 && <div className="dp-line">No changes yet.</div>}
            {live.eventsCapped && <div className="dp-note">Showing the latest {PANEL_EVENT_LIMIT} changes.</div>}
            {live.events.map((ev) => (
              <div key={ev.id} className="dp-event">
                <span className="dp-event-meta">
                  {ev.when}, {ev.who}
                </span>
                {ev.lines.map((line, i) => (
                  <span key={i} className="dp-line">
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="dp-sub">No DIY program running.</p>
      )}

      {data.past.length > 0 && (
        <div className="dp-card">
          <div className="dp-card-title">Past programs</div>
          {data.past.map((p, i) => (
            <div key={i} className="dp-line">
              {p.name}, ended {p.ended}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
