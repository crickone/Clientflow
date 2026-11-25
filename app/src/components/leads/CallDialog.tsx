"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, PhoneCall } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { logCallAction, scheduleCallAction, type ActionResult } from "@/app/leads/callActions";
import { CALL_OUTCOMES, CALLBACK_PICKS, callbackDay, type CallbackPick, type CallOutcome } from "@/lib/leadFlows/callPlan";
import { todayIn } from "@/lib/leadFlows/sendingWindow";

export type CallMode = "log" | "schedule";
type DayPick = CallbackPick | "date" | "none";

const pill = (on: boolean): CSSProperties => ({
  padding: "10px 14px",
  borderRadius: "var(--radius)",
  border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
  background: on ? "var(--accent)" : "var(--surface-1)",
  color: on ? "var(--accent-contrast)" : "var(--text-primary)",
  fontSize: 13.5,
  fontWeight: on ? 600 : 500,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "left",
});
const question: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", margin: "4px 0 8px" };
const hint: CSSProperties = { fontSize: 12.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 };

function DayPicker(props: { value: DayPick; onChange: (v: DayPick) => void; date: string; onDate: (v: string) => void; today: string }) {
  const { value, onChange, date, onDate, today } = props;
  return (
    <div>
      <div role="radiogroup" aria-label="Which day" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CALLBACK_PICKS.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={value === p.key} style={pill(value === p.key)} onClick={() => onChange(p.key)}>
            {p.label}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={value === "date"} style={pill(value === "date")} onClick={() => onChange("date")}>
          Pick a date
        </button>
        <button type="button" role="radio" aria-checked={value === "none"} style={pill(value === "none")} onClick={() => onChange("none")}>
          No day
        </button>
      </div>
      {value === "date" && (
        <div style={{ marginTop: 10 }}>
          <Label htmlFor="call-day">Day</Label>
          <Input id="call-day" type="date" min={today} value={date} onChange={(e) => onDate(e.target.value)} />
        </div>
      )}
      <p style={hint}>
        {value === "none"
          ? "They go to Call back later. Its follow-ups start after its own wait, 2 days unless you changed it."
          : "They go to Call back later. You get a reminder that morning; if nobody reaches them that day, the follow-ups start the next morning."}
      </p>
    </div>
  );
}

/** Log a call that just happened, or schedule one. Used on the lead page and the board card. */
export function CallDialog({
  leadId,
  leadName,
  open,
  mode,
  onOpenChange,
}: {
  leadId: number;
  leadName: string;
  open: boolean;
  mode: CallMode;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [today, setToday] = useState(() => todayIn(Date.now()));
  const [tab, setTab] = useState<CallMode>(mode);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState<"time" | "day">("time");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("10:00");
  const [dayPick, setDayPick] = useState<DayPick>("tomorrow");
  const [pickedDate, setPickedDate] = useState("");
  const [pending, start] = useTransition();

  // Each opening starts clean, on the tab it was opened for.
  useEffect(() => {
    if (!open) return;
    const now = todayIn(Date.now());
    setToday(now);
    setTab(mode);
    setOutcome(null);
    setNote("");
    setWhen("time");
    setDate(now);
    setTime("10:00");
    setDayPick("tomorrow");
    setPickedDate("");
  }, [open, mode]);

  function pickedDay(): { day: string | null } | { error: string } {
    if (dayPick === "none") return { day: null };
    if (dayPick === "date") return pickedDate ? { day: pickedDate } : { error: "Pick a day." };
    return { day: callbackDay(dayPick, today) };
  }

  function done(res: ActionResult) {
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Saved.");
    onOpenChange(false);
    router.refresh();
  }

  function submit() {
    start(async () => {
      if (tab === "log") {
        if (!outcome) {
          toast.error("Pick what happened on the call.");
          return;
        }
        let callbackDayValue: string | null = null;
        if (outcome === "call_back") {
          const d = pickedDay();
          if ("error" in d) {
            toast.error(d.error);
            return;
          }
          callbackDayValue = d.day;
        }
        done(await logCallAction(leadId, { outcome, note: note.trim() || null, callbackDay: callbackDayValue }));
        return;
      }
      if (when === "time") {
        if (!date || !time) {
          toast.error("Pick a day and a time.");
          return;
        }
        done(await scheduleCallAction(leadId, { date, time }));
        return;
      }
      const d = pickedDay();
      if ("error" in d) {
        toast.error(d.error);
        return;
      }
      done(await scheduleCallAction(leadId, { day: d.day }));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={tab === "log" ? "Log a call" : "Schedule a call"} description={leadName} width={540}>
        <div role="tablist" aria-label="Call" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button type="button" role="tab" aria-selected={tab === "log"} style={pill(tab === "log")} onClick={() => setTab("log")}>
            <PhoneCall size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden />
            Log a call
          </button>
          <button type="button" role="tab" aria-selected={tab === "schedule"} style={pill(tab === "schedule")} onClick={() => setTab("schedule")}>
            <CalendarClock size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden />
            Schedule a call
          </button>
        </div>

        {tab === "log" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <p style={question}>What happened?</p>
              <div role="radiogroup" aria-label="What happened" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                {CALL_OUTCOMES.map((o) => (
                  <button key={o.key} type="button" role="radio" aria-checked={outcome === o.key} style={pill(outcome === o.key)} onClick={() => setOutcome(o.key)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {outcome === "call_back" && (
              <div>
                <p style={question}>When do they want a call?</p>
                <DayPicker value={dayPick} onChange={setDayPick} date={pickedDate} onDate={setPickedDate} today={today} />
              </div>
            )}
            <div>
              <Label htmlFor="call-note" srOnly>
                Note
              </Label>
              <Textarea id="call-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <p style={question}>When?</p>
              <div role="radiogroup" aria-label="When" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" role="radio" aria-checked={when === "time"} style={pill(when === "time")} onClick={() => setWhen("time")}>
                  At a time
                </button>
                <button type="button" role="radio" aria-checked={when === "day"} style={pill(when === "day")} onClick={() => setWhen("day")}>
                  On a day, no time
                </button>
              </div>
            </div>
            {when === "time" ? (
              <div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ flex: "1 1 180px" }}>
                    <Label htmlFor="call-date">Day</Label>
                    <Input id="call-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div style={{ flex: "1 1 140px" }}>
                    <Label htmlFor="call-time">Time</Label>
                    <Input id="call-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </div>
                </div>
                <p style={hint}>They go to Consultation booked and the call goes in the diary. They get a WhatsApp confirmation now and a reminder an hour before; you get an alert 10 minutes before.</p>
              </div>
            ) : (
              <DayPicker value={dayPick} onChange={setDayPick} date={pickedDate} onDate={setPickedDate} today={today} />
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {tab === "log" ? "Save" : when === "time" ? "Book the call" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
