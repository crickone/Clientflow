"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { deleteEventAction, saveEventAction } from "@/app/calendar/actions";
import type { CalendarEvent } from "@/lib/calendar";

type Cell = { date: string; day: number; inMonth: boolean; isToday: boolean };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const COLORS = [
  { name: "Accent", hex: "" },
  { name: "Blue", hex: "#4d8df0" },
  { name: "Green", hex: "#22c55e" },
  { name: "Purple", hex: "#a366e6" },
  { name: "Red", hex: "#ef4444" },
  { name: "Amber", hex: "#f59e0b" },
];

type Draft = Partial<CalendarEvent> & { date: string };

export function CalendarView({
  label,
  prevMonth,
  nextMonth,
  thisMonth,
  today,
  cells,
  events,
}: {
  label: string;
  prevMonth: string;
  nextMonth: string;
  thisMonth: string;
  today: string;
  cells: Cell[];
  events: CalendarEvent[];
}) {
  const [editing, setEditing] = useState<Draft | null>(null);

  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Link href={`/calendar?m=${prevMonth}`}>
          <Button variant="ghost" size="icon" title="Previous month"><ChevronLeft size={16} /></Button>
        </Link>
        <Link href={`/calendar?m=${nextMonth}`}>
          <Button variant="ghost" size="icon" title="Next month"><ChevronRight size={16} /></Button>
        </Link>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: "0 6px" }}>{label}</h2>
        <Link href={`/calendar?m=${thisMonth}`}>
          <Button variant="ghost" size="sm">Today</Button>
        </Link>
        <Button style={{ marginLeft: "auto" }} onClick={() => setEditing({ date: today, allDay: false })}>
          <Plus size={14} strokeWidth={2} /> New event
        </Button>
      </div>

      {/* Weekday header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 1 }}>
        {WEEKDAYS.map((d) => (
          <div key={d} style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "6px 8px", textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--hairline)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {cells.map((c) => {
          const dayEvents = byDate.get(c.date) ?? [];
          return (
            <div
              key={c.date}
              onClick={() => setEditing({ date: c.date, allDay: false })}
              style={{
                minHeight: 108,
                background: c.inMonth ? "var(--surface-1)" : "var(--bg)",
                padding: 6,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: c.isToday ? 700 : 500,
                    color: c.isToday ? "#1a0a03" : c.inMonth ? "var(--text-secondary)" : "var(--text-tertiary)",
                    background: c.isToday ? "var(--accent)" : "transparent",
                    borderRadius: 20,
                    minWidth: 20,
                    height: 20,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 5px",
                  }}
                >
                  {c.day}
                </span>
              </div>
              {dayEvents.slice(0, 3).map((e) => (
                <button
                  key={e.id}
                  onClick={(ev) => { ev.stopPropagation(); setEditing({ ...e }); }}
                  style={{
                    textAlign: "left",
                    border: "none",
                    borderRadius: 5,
                    padding: "2px 6px",
                    background: "var(--surface-2)",
                    borderLeft: `3px solid ${e.color || "var(--accent)"}`,
                    color: "var(--text-primary)",
                    fontSize: 11.5,
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={e.title}
                >
                  {!e.allDay && e.startTime ? <span style={{ color: "var(--text-tertiary)" }}>{e.startTime} </span> : null}
                  {e.title}
                </button>
              ))}
              {dayEvents.length > 3 && (
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", paddingLeft: 4 }}>+{dayEvents.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <EventDialog
          draft={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function EventDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = typeof draft.id === "number";

  const [title, setTitle] = useState(draft.title ?? "");
  const [date, setDate] = useState(draft.date);
  const [allDay, setAllDay] = useState(draft.allDay ?? false);
  const [startTime, setStartTime] = useState(draft.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(draft.endTime ?? "");
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [color, setColor] = useState(draft.color ?? "");

  function save() {
    if (!title.trim()) { toast.error("Give the event a title."); return; }
    start(async () => {
      const res = await saveEventAction(isEdit ? draft.id! : null, {
        title,
        description,
        date,
        startTime: allDay ? "" : startTime,
        endTime: allDay ? "" : endTime,
        allDay,
        location,
        color,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(isEdit ? "Event updated" : "Event added");
      onClose();
      router.refresh();
    });
  }

  function remove() {
    if (!isEdit) return;
    start(async () => {
      const res = await deleteEventAction(draft.id!);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Event deleted");
      onClose();
      router.refresh();
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--bg)",
    border: "1px solid var(--hairline)",
    borderRadius: "var(--radius)",
    padding: "10px 14px",
    color: "var(--text-primary)",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent title={isEdit ? "Edit event" : "New event"} width={520}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor="ev-title">Title</Label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Meeting with supplier" autoFocus disabled={pending} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: allDay ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <Label htmlFor="ev-date">Date</Label>
              <input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={pending} style={inputStyle} />
            </div>
            {!allDay && (
              <>
                <div>
                  <Label htmlFor="ev-start">Start</Label>
                  <input id="ev-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={pending} style={inputStyle} />
                </div>
                <div>
                  <Label htmlFor="ev-end">End</Label>
                  <input id="ev-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={pending} style={inputStyle} />
                </div>
              </>
            )}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 14 }}>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={pending} />
            All day
          </label>
          <div>
            <Label htmlFor="ev-loc">Location (optional)</Label>
            <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Office / Zoom" disabled={pending} />
          </div>
          <div>
            <Label htmlFor="ev-desc">Notes (optional)</Label>
            <textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={pending} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
          </div>
          <div>
            <Label>Colour</Label>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {COLORS.map((c) => {
                const selected = color === c.hex;
                return (
                  <button
                    key={c.name}
                    onClick={() => setColor(c.hex)}
                    title={c.name}
                    disabled={pending}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: c.hex || "var(--accent)",
                      border: selected ? "2px solid var(--text-primary)" : "2px solid transparent",
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
            {isEdit ? (
              <Button variant="ghost" onClick={remove} disabled={pending} style={{ color: "#ef4444" }}>
                <Trash2 size={14} /> Delete
              </Button>
            ) : <span />}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
