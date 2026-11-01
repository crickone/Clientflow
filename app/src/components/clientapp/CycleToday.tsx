"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { dayLabel } from "@/components/clientapp/ui";
import { logPeriodAction, setCycleDayAction, setCycleNoteAction } from "@/app/app/actions";
import { DAY_FIELDS, DAY_SCALE, type DayField, type DayLog } from "@/lib/cycleModel";

/** The period buttons: started today / ended today, with "a different day" underneath. */
export function PeriodButtons({ onPeriod, openStart, today, tracking }: { onPeriod: boolean; /** Start of the last period that has no end logged, when it is no longer on. */ openStart: string | null; today: string; tracking: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<"start" | "end" | null>(null);
  const [day, setDay] = useState(today);
  if (!tracking) return null;

  function log(kind: "start" | "end", d: string) {
    start(async () => {
      const r = await logPeriodAction(kind, d);
      if (!r.ok) toast.error(r.error);
      else setPick(null);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {onPeriod ? (
        <Button variant="secondary" size="lg" loading={pending} onClick={() => log("end", today)}>
          My period ended today
        </Button>
      ) : (
        <Button size="lg" loading={pending} onClick={() => log("start", today)}>
          My period started today
        </Button>
      )}
      {pick ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" className="cy-date" value={day} max={today} onChange={(e) => setDay(e.target.value)} aria-label="Which day" />
          <Button size="md" loading={pending} onClick={() => log(pick, day)}>
            Save
          </Button>
          <Button size="md" variant="ghost" onClick={() => setPick(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 16px" }}>
          <button type="button" className="cy-link" onClick={() => setPick(onPeriod ? "end" : "start")}>
            {onPeriod ? "It ended on a different day" : "It started on a different day"}
          </button>
          {!onPeriod && openStart && (
            <button type="button" className="cy-link" onClick={() => setPick("end")}>
              When did the one from {dayLabel(openStart, { day: "numeric", month: "short" })} end?
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Today's check-in: five questions, three chips each. One tap saves. */
export function DayCheckin({ log }: { log: DayLog }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<DayField, number | null>>({ energy: log.energy, mood: log.mood, sleep: log.sleep, pain: log.pain, cravings: log.cravings });
  const [note, setNote] = useState(log.note ?? "");
  const [savedNote, setSavedNote] = useState(log.note ?? "");
  const [, start] = useTransition();

  function pick(field: DayField, v: number) {
    const next = vals[field] === v ? null : v;
    setVals((s) => ({ ...s, [field]: next }));
    start(async () => {
      const r = await setCycleDayAction(log.day, field, next);
      if (!r.ok) {
        toast.error(r.error);
        setVals((s) => ({ ...s, [field]: vals[field] }));
      }
      router.refresh();
    });
  }

  function saveNote() {
    if (note.trim() === savedNote.trim()) return;
    start(async () => {
      const r = await setCycleNoteAction(log.day, note);
      if (r.ok) setSavedNote(note);
      else toast.error(r.error);
      router.refresh();
    });
  }

  return (
    <div className="cy-checkin">
      {DAY_FIELDS.map((f) => (
        <div key={f} className="cy-row">
          <span className="cy-row-label">{DAY_SCALE[f].label}</span>
          <div className="cy-chips" role="group" aria-label={DAY_SCALE[f].label}>
            {DAY_SCALE[f].options.map((label, i) => (
              <button key={label} type="button" className="cy-chip" data-on={vals[f] === i + 1} aria-pressed={vals[f] === i + 1} onClick={() => pick(f, i + 1)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <textarea className="cy-note" rows={2} placeholder="Anything else about today (optional)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} maxLength={500} />
    </div>
  );
}
