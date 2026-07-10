"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  Repeat,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { initialsOf } from "@/lib/utils";
import {
  bookAction,
  cancelSessionAction,
  createClassAction,
  deleteSessionAction,
  markAttendanceAction,
  unbookAction,
  updateSessionAction,
} from "@/app/timetable/actions";

// ── client-side shapes (lean subset of the server rows) ───────────────────────

interface Attendee {
  bookingId: number;
  clientId: number;
  name: string;
  status: string;
}
export interface ClientSession {
  id: number;
  scheduleId: number | null;
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  description: string | null;
  category: string | null;
  color: string;
  capacity: number;
  location: string | null;
  instructor: string | null;
  visibility: string;
  status: string;
  attendees: Attendee[];
  filled: number;
}
interface ClientLite {
  id: number;
  name: string;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SWATCHES = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#64748b",
];
const pad2 = (n: number) => String(n).padStart(2, "0");
function parseIso(iso: string) {
  return new Date(`${iso}T00:00:00`);
}
function dowOf(iso: string) {
  return parseIso(iso).getDay();
}
function addDaysIso(iso: string, n: number) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dayNum(iso: string) {
  return parseIso(iso).getDate();
}
function hm2min(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
function fmtHour(h: number) {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
// Assign overlapping sessions in a day to side-by-side lanes.
function packLanes(list: ClientSession[]) {
  const sorted = list.slice().sort((a, b) => hm2min(a.startTime) - hm2min(b.startTime));
  const laneEnds: number[] = [];
  const packed: { s: ClientSession; lane: number }[] = [];
  for (const s of sorted) {
    const start = hm2min(s.startTime);
    const end = hm2min(s.endTime);
    let lane = laneEnds.findIndex((e) => start >= e);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    packed.push({ s, lane });
  }
  return { packed, lanes: Math.max(1, laneEnds.length) };
}
function weekLabel(weekStart: string) {
  const a = parseIso(weekStart);
  const b = parseIso(addDaysIso(weekStart, 6));
  const mo = (d: Date) => d.toLocaleDateString("en-IE", { month: "short" });
  const sameMonth = a.getMonth() === b.getMonth();
  const yr = b.getFullYear();
  return sameMonth
    ? `${a.getDate()} – ${b.getDate()} ${mo(b)} ${yr}`
    : `${a.getDate()} ${mo(a)} – ${b.getDate()} ${mo(b)} ${yr}`;
}
function initials(name: string) {
  const [a, b = ""] = name.trim().split(/\s+/);
  return initialsOf(a ?? "", b) || "?";
}
function hexToRgba(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ── main view ─────────────────────────────────────────────────────────────────

export function TimetableView({
  weekStart,
  prevWeek,
  nextWeek,
  today,
  view,
  dayIso,
  sessions,
  clients,
}: {
  weekStart: string;
  prevWeek: string;
  nextWeek: string;
  today: string;
  view: "week" | "day";
  dayIso: string;
  sessions: ClientSession[];
  clients: ClientLite[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<string>(today);
  const [createTime, setCreateTime] = useState<string>("09:00");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<ClientSession | null>(null);

  const selected = selectedId
    ? sessions.find((s) => s.id === selectedId) ?? null
    : null;

  const days = useMemo(
    () =>
      view === "day"
        ? [dayIso]
        : Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)),
    [weekStart, view, dayIso],
  );
  const byDate = useMemo(() => {
    const m = new Map<string, ClientSession[]>();
    for (const s of sessions) {
      const list = m.get(s.date) ?? [];
      list.push(s);
      m.set(s.date, list);
    }
    return m;
  }, [sessions]);

  // Tick every minute so the "next class" highlight stays current.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // The next upcoming (not-cancelled) session in the loaded set → gets a pulse.
  const nextId = useMemo(() => {
    if (nowMs == null) return null;
    let best: number | null = null;
    let bestT = Infinity;
    for (const s of sessions) {
      if (s.status === "cancelled") continue;
      const t = new Date(`${s.date}T${s.startTime}:00`).getTime();
      if (t >= nowMs && t < bestT) {
        bestT = t;
        best = s.id;
      }
    }
    return best;
  }, [sessions, nowMs]);

  // Visible hour window: default 7am–9pm, widened to fit any session.
  const { startHour, endHour } = useMemo(() => {
    let min = 7 * 60;
    let max = 21 * 60;
    for (const s of sessions) {
      min = Math.min(min, hm2min(s.startTime));
      max = Math.max(max, hm2min(s.endTime));
    }
    return {
      startHour: Math.max(0, Math.floor(min / 60)),
      endHour: Math.min(24, Math.ceil(max / 60)),
    };
  }, [sessions]);

  const go = (params: Record<string, string>) => {
    router.push(`/timetable?${new URLSearchParams(params).toString()}`);
  };
  const openCreate = (date: string, time = "09:00") => {
    setCreateDate(date);
    setCreateTime(time);
    setCreateOpen(true);
  };

  return (
    <>
      {/* toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous"
            onClick={() =>
              go(view === "day"
                ? { view: "day", day: addDaysIso(dayIso, -1), week: weekStart }
                : { week: prevWeek })
            }
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next"
            onClick={() =>
              go(view === "day"
                ? { view: "day", day: addDaysIso(dayIso, 1), week: weekStart }
                : { week: nextWeek })
            }
          >
            <ChevronRight size={16} />
          </Button>
          <div
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: 17,
              textTransform: "uppercase",
              letterSpacing: "0.02em",
              marginLeft: 6,
              minWidth: 210,
            }}
          >
            {view === "day"
              ? parseIso(dayIso).toLocaleDateString("en-IE", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : weekLabel(weekStart)}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              go(view === "day" ? { view: "day", day: today } : { week: today })
            }
          >
            Today
          </Button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <div
            style={{
              display: "inline-flex",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
            }}
          >
            {(["week", "day"] as const).map((v) => (
              <button
                key={v}
                onClick={() =>
                  go(v === "day" ? { view: "day", day: dayIso, week: weekStart } : { week: weekStart })
                }
                style={{
                  padding: "7px 16px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontFamily: "var(--font-mono), monospace",
                  background: view === v ? "var(--surface-2)" : "transparent",
                  color: view === v ? "var(--text-primary)" : "var(--text-tertiary)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {v}
              </button>
            ))}
          </div>
          <Button onClick={() => openCreate(view === "day" ? dayIso : today)}>
            <CalendarPlus size={15} />
            New session
          </Button>
        </div>
      </div>

      <TimeGrid
        days={days}
        byDate={byDate}
        startHour={startHour}
        endHour={endHour}
        today={today}
        nextId={nextId}
        onSlot={(date, time) => openCreate(date, time)}
        onSession={(id) => setSelectedId(id)}
        onDayHeader={(d) => go({ view: "day", day: d, week: weekStart })}
      />

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        date={createDate}
        initialStart={createTime}
        weekStart={weekStart}
        onCreated={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />

      <SessionSheet
        session={selected}
        clients={clients}
        onClose={() => setSelectedId(null)}
        onChanged={() => router.refresh()}
        onEdit={(s) => setEditing(s)}
      />

      <EditSessionDialog
        session={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </>
  );
}

// ── time-axis grid (elastic rows: a taller card grows its slot everywhere) ────

const SLOT_MIN = 15; // minutes per grid row
const SLOT_PX = 23; // min pixels per row → ~92px/hour, grows with content
const SLOTS_PER_HOUR = 60 / SLOT_MIN;

function TimeGrid({
  days,
  byDate,
  startHour,
  endHour,
  today,
  nextId,
  onSlot,
  onSession,
  onDayHeader,
}: {
  days: string[];
  byDate: Map<string, ClientSession[]>;
  startHour: number;
  endHour: number;
  today: string;
  nextId: number | null;
  onSlot: (date: string, time: string) => void;
  onSession: (id: number) => void;
  onDayHeader: (date: string) => void;
}) {
  const n = days.length;
  const dayStart = startHour * 60;
  const totalSlots = ((endHour - startHour) * 60) / SLOT_MIN;
  const line = "1px solid rgba(255,255,255,0.06)";
  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = startHour; h < endHour; h++) arr.push(h);
    return arr;
  }, [startHour, endHour]);

  // body slot i (0-based) sits on grid-row line (i + 2); row 1 is the header.
  const slotOf = (min: number) => Math.round((min - dayStart) / SLOT_MIN);

  return (
    <div style={{ overflowX: "auto", paddingBottom: 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${n}, minmax(196px, 1fr))`,
          gridTemplateRows: `auto repeat(${totalSlots}, minmax(${SLOT_PX}px, auto))`,
          minWidth: n > 1 ? 56 + n * 196 : 360,
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        {/* header row */}
        <div style={{ gridColumn: 1, gridRow: 1, borderBottom: "1px solid var(--hairline)" }} />
        {days.map((d, i) => {
          const isToday = d === today;
          return (
            <button
              key={`h-${d}`}
              onClick={() => onDayHeader(d)}
              style={{
                gridColumn: i + 2,
                gridRow: 1,
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                textAlign: "left",
                padding: "10px 14px",
                borderBottom: "1px solid var(--hairline)",
                borderLeft: line,
                background: isToday ? "var(--accent-soft)" : "transparent",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  fontSize: 22,
                  lineHeight: 1,
                  fontFamily: "var(--font-heading), sans-serif",
                  color: isToday ? "var(--accent-ink)" : "var(--text-primary)",
                }}
              >
                {dayNum(d)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontFamily: "var(--font-mono), monospace",
                  color: isToday ? "var(--accent-ink)" : "var(--text-tertiary)",
                }}
              >
                {DOW[dowOf(d)]}
              </span>
            </button>
          );
        })}

        {/* hour labels (gutter) */}
        {hours.map((h) => (
          <div
            key={`g-${h}`}
            style={{
              gridColumn: 1,
              gridRow: `${slotOf(h * 60) + 2} / span ${SLOTS_PER_HOUR}`,
              padding: "5px 8px 0 0",
              textAlign: "right",
              fontSize: 10.5,
              fontFamily: "var(--font-mono), monospace",
              color: "var(--text-tertiary)",
              borderTop: h === startHour ? "none" : line,
            }}
          >
            {fmtHour(h)}
          </div>
        ))}

        {/* empty hour cells — grid lines + click-to-add */}
        {days.map((d, di) =>
          hours.map((h) => (
            <button
              key={`bg-${d}-${h}`}
              onClick={() => onSlot(d, `${pad2(h)}:00`)}
              title={`Add a session at ${fmtHour(h)}`}
              style={{
                gridColumn: di + 2,
                gridRow: `${slotOf(h * 60) + 2} / span ${SLOTS_PER_HOUR}`,
                borderTop: h === startHour ? "none" : line,
                borderLeft: line,
                background: d === today ? "rgba(255,255,255,0.015)" : "transparent",
                cursor: "pointer",
              }}
            />
          )),
        )}

        {/* session cards — placed by time span; content grows the row */}
        {days.map((d, di) => {
          const { packed, lanes } = packLanes(byDate.get(d) ?? []);
          return packed.map(({ s, lane }) => {
            const startSlot = slotOf(hm2min(s.startTime));
            const endSlot = Math.max(
              startSlot + 1,
              Math.ceil((hm2min(s.endTime) - dayStart) / SLOT_MIN),
            );
            const wLane = 100 / lanes;
            return (
              <div
                key={s.id}
                style={{
                  gridColumn: di + 2,
                  gridRow: `${startSlot + 2} / ${endSlot + 2}`,
                  marginLeft: `${wLane * lane}%`,
                  width: `calc(${wLane}% - 4px)`,
                  padding: 2,
                  zIndex: 2,
                  display: "flex",
                  minHeight: 0,
                }}
              >
                <SessionCard s={s} isNext={s.id === nextId} onClick={() => onSession(s.id)} />
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

function SessionCard({
  s,
  isNext = false,
  onClick,
}: {
  s: ClientSession;
  isNext?: boolean;
  onClick: () => void;
}) {
  const full = s.filled >= s.capacity;
  const cancelled = s.status === "cancelled";
  const pct = s.capacity > 0 ? Math.min(1, s.filled / s.capacity) : 0;
  const barColor = full ? "var(--accent)" : s.color;

  return (
    <button
      onClick={onClick}
      className={isNext ? "tt-next-pulse" : undefined}
      style={{
        textAlign: "left",
        width: "100%",
        borderRadius: 10,
        border: isNext ? `1px solid ${s.color}` : `1px solid ${hexToRgba(s.color, 0.5)}`,
        borderLeft: `4px solid ${s.color}`,
        background: hexToRgba(s.color, cancelled ? 0.06 : isNext ? 0.28 : 0.18),
        padding: "10px 11px",
        cursor: "pointer",
        opacity: cancelled ? 0.62 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        lineHeight: 1.3,
        // pulse ring colour follows the class colour
        ...(isNext
          ? ({
              ["--tt-pulse" as string]: hexToRgba(s.color, 0.9),
              ["--tt-pulse-0" as string]: hexToRgba(s.color, 0),
            } as React.CSSProperties)
          : {}),
      }}
    >
      {isNext && (
        <span
          style={{
            alignSelf: "flex-start",
            fontSize: 9.5,
            fontFamily: "var(--font-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--accent-ink, #fff)",
            background: hexToRgba(s.color, 0.9),
            borderRadius: 4,
            padding: "1px 6px",
          }}
        >
          Next up
        </span>
      )}
      {/* title */}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-primary)",
          textDecoration: cancelled ? "line-through" : "none",
        }}
      >
        {s.name}
        {cancelled && (
          <span style={{ ...blockMeta, display: "inline", marginLeft: 6, color: "var(--accent-ink)" }}>
            (cancelled)
          </span>
        )}
      </div>

      {/* time */}
      <div
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono), monospace",
          color: "var(--text-secondary)",
        }}
      >
        {s.startTime}–{s.endTime}
      </div>

      {/* meta */}
      {(s.instructor || s.location) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {s.instructor && (
            <div style={blockMeta}>
              <User size={12} style={{ flexShrink: 0 }} />
              <span style={blockMetaText}>{s.instructor}</span>
            </div>
          )}
          {s.location && (
            <div style={blockMeta}>
              <MapPin size={12} style={{ flexShrink: 0 }} />
              <span style={blockMetaText}>{s.location}</span>
            </div>
          )}
        </div>
      )}

      {/* capacity */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
          <div style={{ width: `${pct * 100}%`, height: "100%", background: barColor }} />
        </div>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono), monospace",
            color: full ? "var(--accent-ink)" : "var(--text-tertiary)",
          }}
        >
          {s.filled}/{s.capacity} booked{full ? " · Full" : ""}
        </div>
      </div>
    </button>
  );
}

const blockMeta: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11.5,
  color: "var(--text-secondary)",
};
const blockMetaText: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// ── create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  open,
  onClose,
  date,
  initialStart,
  weekStart,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  initialStart: string;
  weekStart: string;
  onCreated: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [theDate, setTheDate] = useState(date);
  const [startTime, setStartTime] = useState(initialStart);
  const [durationMin, setDurationMin] = useState(60);
  const [capacity, setCapacity] = useState(12);
  const [location, setLocation] = useState("");
  const [instructor, setInstructor] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [color, setColor] = useState(SWATCHES[0]);
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [endDate, setEndDate] = useState("");

  // Re-seed the form each time the dialog is opened from a specific slot.
  const seedKey = `${date}T${initialStart}`;
  const [seededFor, setSeededFor] = useState(seedKey);
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setTheDate(date);
    setStartTime(initialStart);
    setDays([dowOf(date)]);
  }

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const submit = () => {
    if (!name.trim()) {
      toast.error("Give the session a name.");
      return;
    }
    start(async () => {
      const res = await createClassAction({
        name,
        category: category || null,
        description: description || null,
        color,
        capacity,
        location: location || null,
        instructor: instructor || null,
        visibility,
        startTime,
        durationMin,
        repeat,
        date: theDate,
        startDate: theDate,
        daysOfWeek: repeat ? (days.length ? days : [dowOf(theDate)]) : undefined,
        endDate: repeat && endDate ? endDate : null,
        weekStart,
      });
      if (res.ok) {
        toast.success(repeat ? "Recurring class created." : "Session created.");
        setName("");
        setDescription("");
        setCategory("");
        onCreated();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New session" width={620}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="ts-name">Session name</Label>
            <Input
              id="ts-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Reformer Pilates"
              autoFocus
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="ts-date">Date</Label>
              <Input id="ts-date" type="date" value={theDate} onChange={(e) => setTheDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ts-start">Start</Label>
              <Input id="ts-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ts-dur">Duration (min)</Label>
              <Input
                id="ts-dur"
                type="number"
                min={5}
                step={5}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              />
            </div>
          </div>

          <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => {
                  setRepeat(e.target.checked);
                  if (e.target.checked && days.length === 0) setDays([dowOf(theDate)]);
                }}
              />
              <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Repeat weekly</span>
            </label>
            {repeat && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      style={{
                        width: 40,
                        height: 34,
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--hairline)",
                        background: days.includes(i) ? "var(--accent)" : "transparent",
                        color: days.includes(i) ? "#fff" : "var(--text-secondary)",
                        fontSize: 11,
                        cursor: "pointer",
                        fontFamily: "var(--font-mono), monospace",
                      }}
                    >
                      {DOW[i].slice(0, 2)}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 12, maxWidth: 220 }}>
                  <Label htmlFor="ts-end">Ends (optional)</Label>
                  <Input id="ts-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="ts-cap">Capacity (clients)</Label>
              <Input id="ts-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="ts-cat">Category</Label>
              <Input id="ts-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Pilates" />
            </div>
            <div>
              <Label htmlFor="ts-loc">Location</Label>
              <Input id="ts-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Studio 1" />
            </div>
            <div>
              <Label htmlFor="ts-inst">Instructor</Label>
              <Input id="ts-inst" value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="e.g. Sarah" />
            </div>
          </div>

          <div>
            <Label>Colour</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: c,
                    border: color === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                    outline: color === c ? "1px solid var(--text-primary)" : "none",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ maxWidth: 300 }}>
            <Label htmlFor="ts-vis">Visibility</Label>
            <select id="ts-vis" value={visibility} onChange={(e) => setVisibility(e.target.value)} style={selectStyle}>
              <option value="public">Public — anyone can book</option>
              <option value="clients">All clients</option>
              <option value="private">Just me (internal)</option>
            </select>
          </div>

          <div>
            <Label htmlFor="ts-desc">Description</Label>
            <Textarea
              id="ts-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What should clients know about this session?"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : repeat ? "Create class" : "Create session"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── session detail slide-over (booking + attendance) ──────────────────────────

function SessionSheet({
  session,
  clients,
  onClose,
  onChanged,
  onEdit,
}: {
  session: ClientSession | null;
  clients: ClientLite[];
  onClose: () => void;
  onChanged: () => void;
  onEdit: (s: ClientSession) => void;
}) {
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");

  const bookedIds = useMemo(
    () => new Set((session?.attendees ?? []).map((a) => a.clientId)),
    [session],
  );
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return clients
      .filter((c) => !bookedIds.has(c.id))
      .filter((c) => (query ? c.name.toLowerCase().includes(query) : true))
      .slice(0, 8);
  }, [q, clients, bookedIds]);

  if (!session) return null;
  const full = session.filled >= session.capacity;
  const cancelled = session.status === "cancelled";
  const recurring = session.scheduleId != null;

  const book = (clientId: number) =>
    start(async () => {
      const res = await bookAction(session.id, clientId);
      if (res.ok) {
        setQ("");
        onChanged();
      } else {
        toast.error(res.error);
      }
    });
  const unbook = (clientId: number) =>
    start(async () => {
      await unbookAction(session.id, clientId);
      onChanged();
    });
  const toggleAttended = (bookingId: number, attended: boolean) =>
    start(async () => {
      await markAttendanceAction(bookingId, attended ? "booked" : "attended");
      onChanged();
    });
  const toggleCancel = () =>
    start(async () => {
      await cancelSessionAction(session.id, !cancelled);
      onChanged();
    });
  const remove = () =>
    start(async () => {
      await deleteSessionAction(session.id);
      onClose();
      onChanged();
    });

  return (
    <Sheet open={!!session} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Session details" width={460}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* summary */}
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: session.color,
                  marginTop: 7,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h2
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-heading), sans-serif",
                      fontSize: 22,
                      textTransform: "uppercase",
                      lineHeight: 1.1,
                    }}
                  >
                    {session.name}
                  </h2>
                  {recurring && (
                    <span style={chip}>
                      <Repeat size={11} /> Repeats
                    </span>
                  )}
                  {cancelled && <span style={{ ...chip, color: "var(--accent-ink)" }}>Cancelled</span>}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono), monospace",
                  }}
                >
                  {parseIso(session.date).toLocaleDateString("en-IE", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}{" "}
                  · {session.startTime}–{session.endTime}
                </div>
              </div>
            </div>

            {(session.location || session.instructor || session.category) && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  marginTop: 12,
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                }}
              >
                {session.location && (
                  <span style={metaRow}>
                    <MapPin size={13} />
                    {session.location}
                  </span>
                )}
                {session.instructor && (
                  <span style={metaRow}>
                    <User size={13} />
                    {session.instructor}
                  </span>
                )}
                {session.category && <span style={chip}>{session.category}</span>}
              </div>
            )}

            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: "var(--radius)",
                background: "var(--surface-2)",
              }}
            >
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Spaces filled</span>
              <span
                style={{
                  fontFamily: "var(--font-mono), monospace",
                  fontSize: 14,
                  color: full ? "var(--accent-ink)" : "var(--text-primary)",
                }}
              >
                {session.filled}/{session.capacity}
                {full ? " · Full" : ""}
              </span>
            </div>

            {session.description && (
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "12px 0 0" }}>
                {session.description}
              </p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
              <Button size="sm" onClick={() => onEdit(session)}>
                <Pencil size={13} /> Edit
              </Button>
              <Button size="sm" variant="outline" onClick={toggleCancel} disabled={pending}>
                {cancelled ? "Restore" : "Cancel"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={remove}
                disabled={pending}
                aria-label="Delete session"
                style={{ marginLeft: "auto" }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>

          <div style={{ height: 1, background: "var(--hairline)" }} />

          {/* bookings */}
          <div>
            <h3 style={{ ...sectionH, marginBottom: 10 }}>
              Bookings <span style={{ color: "var(--text-tertiary)" }}>({session.filled})</span>
            </h3>

            {!cancelled && (
              <div style={{ marginBottom: 10 }}>
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={full ? "Session is full" : "Search a client to book in…"}
                  disabled={full || pending}
                />
                {q.trim() && matches.length > 0 && (
                  <div style={dropdown}>
                    {matches.map((c) => (
                      <button key={c.id} onClick={() => book(c.id)} disabled={pending} style={dropdownItem}>
                        <Avatar initials={initials(c.name)} size={26} />
                        <span style={{ fontSize: 13 }}>{c.name}</span>
                        <UserPlus size={14} style={{ marginLeft: "auto", color: "var(--text-tertiary)" }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {session.attendees.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: "6px 0" }}>
                  No one booked in yet.
                </div>
              )}
              {session.attendees.map((a) => {
                const attended = a.status === "attended";
                return (
                  <div key={a.bookingId} style={rosterRow}>
                    <Avatar initials={initials(a.name)} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {a.name}
                      </div>
                      {attended && (
                        <div
                          style={{
                            fontSize: 10.5,
                            color: "#22c55e",
                            fontFamily: "var(--font-mono), monospace",
                          }}
                        >
                          Attended
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => toggleAttended(a.bookingId, attended)}
                      disabled={pending}
                      title={attended ? "Mark not attended" : "Mark attended"}
                      aria-label="Toggle attendance"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        border: attended ? "1px solid #22c55e" : "1px solid var(--hairline)",
                        background: attended ? "#22c55e" : "transparent",
                        color: attended ? "#04140a" : "var(--text-tertiary)",
                      }}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      onClick={() => unbook(a.clientId)}
                      disabled={pending}
                      aria-label={`Remove ${a.name}`}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--text-tertiary)",
                        cursor: "pointer",
                        display: "inline-flex",
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ height: 1, background: "var(--hairline)" }} />

          {/* waiting list (stub) */}
          <div>
            <h3 style={sectionH}>Waiting list</h3>
            <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: "10px 0", textAlign: "center" }}>
              No results found
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── edit a single occurrence ──────────────────────────────────────────────────

function EditSessionDialog({
  session,
  onClose,
  onSaved,
}: {
  session: ClientSession | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [theDate, setTheDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [durationMin, setDurationMin] = useState(60);
  const [capacity, setCapacity] = useState(12);
  const [location, setLocation] = useState("");
  const [instructor, setInstructor] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [color, setColor] = useState(SWATCHES[0]);

  const [seededId, setSeededId] = useState<number | null>(null);
  if (session && seededId !== session.id) {
    setSeededId(session.id);
    setName(session.name);
    setCategory(session.category ?? "");
    setDescription(session.description ?? "");
    setTheDate(session.date);
    setStartTime(session.startTime);
    setDurationMin(Math.max(5, hm2min(session.endTime) - hm2min(session.startTime)));
    setCapacity(session.capacity);
    setLocation(session.location ?? "");
    setInstructor(session.instructor ?? "");
    setVisibility(session.visibility);
    setColor(session.color);
  }

  if (!session) return null;

  const submit = () => {
    if (!name.trim()) {
      toast.error("Give the session a name.");
      return;
    }
    start(async () => {
      const res = await updateSessionAction(session.id, {
        name,
        category: category || null,
        description: description || null,
        color,
        capacity,
        location: location || null,
        instructor: instructor || null,
        visibility,
        date: theDate,
        startTime,
        durationMin,
      });
      if (res.ok) {
        toast.success("Session updated.");
        onSaved();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit session" width={560}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="es-name">Session name</Label>
            <Input id="es-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="es-date">Date</Label>
              <Input id="es-date" type="date" value={theDate} onChange={(e) => setTheDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="es-start">Start</Label>
              <Input id="es-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="es-dur">Duration (min)</Label>
              <Input
                id="es-dur"
                type="number"
                min={5}
                step={5}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="es-cap">Capacity</Label>
              <Input id="es-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="es-cat">Category</Label>
              <Input id="es-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="es-loc">Location</Label>
              <Input id="es-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="es-inst">Instructor</Label>
              <Input id="es-inst" value={instructor} onChange={(e) => setInstructor(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Colour</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: c,
                    border: color === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                    outline: color === c ? "1px solid var(--text-primary)" : "none",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </div>
          <div style={{ maxWidth: 300 }}>
            <Label htmlFor="es-vis">Visibility</Label>
            <select id="es-vis" value={visibility} onChange={(e) => setVisibility(e.target.value)} style={selectStyle}>
              <option value="public">Public — anyone can book</option>
              <option value="clients">All clients</option>
              <option value="private">Just me (internal)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="es-desc">Description</Label>
            <Textarea id="es-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};

const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-tertiary)",
  border: "1px solid var(--hairline)",
  borderRadius: 5,
  padding: "2px 7px",
  fontFamily: "var(--font-mono), monospace",
};
const metaRow: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5 };
const sectionH: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono), monospace",
};
const dropdown: React.CSSProperties = {
  marginTop: 6,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  overflow: "hidden",
};
const dropdownItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--hairline)",
  color: "var(--text-primary)",
  cursor: "pointer",
};
const rosterRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 10px",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
};
