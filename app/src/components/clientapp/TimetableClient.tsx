"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";

import { Card, dayLabel } from "@/components/clientapp/ui";
import { bookClassAction, cancelClassAction } from "@/app/app/actions";

interface ClientClass {
  id: number;
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  location: string | null;
  instructor: string | null;
  color: string;
  capacity: number;
  filled: number;
  booked: boolean;
  status: string;
}

function weekLabel(weekStart: string) {
  const a = new Date(`${weekStart}T00:00:00`);
  const b = new Date(a);
  b.setDate(b.getDate() + 6);
  const mo = (d: Date) => d.toLocaleDateString("en-IE", { month: "short" });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${mo(b)}`
    : `${a.getDate()} ${mo(a)} – ${b.getDate()} ${mo(b)}`;
}

export function TimetableClient({
  weekStart,
  today,
  prevWeek,
  nextWeek,
  classes,
  canBook,
}: {
  weekStart: string;
  today: string;
  prevWeek: string;
  nextWeek: string;
  classes: ClientClass[];
  canBook: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, start] = useTransition();

  const byDay = useMemo(() => {
    const m = new Map<string, ClientClass[]>();
    for (const c of classes) {
      if (c.status === "cancelled") continue;
      const arr = m.get(c.date) ?? [];
      arr.push(c);
      m.set(c.date, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [classes]);

  const go = (week: string) => router.push(`/app/timetable?week=${week}`);

  const act = (c: ClientClass) => {
    if (!c.booked && !canBook) {
      toast.error("You need an active membership to book classes.");
      return;
    }
    setPendingId(c.id);
    start(async () => {
      const res = c.booked ? await cancelClassAction(c.id) : await bookClassAction(c.id);
      setPendingId(null);
      if (res.ok) {
        toast.success(c.booked ? "Booking cancelled" : "You're booked in!");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase", color: "var(--text-primary)" }}>Classes</h1>

      {!canBook && (
        <div
          onClick={() => router.push("/app/membership")}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "var(--radius-lg)", border: "1px solid var(--accent)", background: "var(--accent-soft)", cursor: "pointer" }}
        >
          <Lock size={16} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Membership required</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Activate a membership to book classes.</div>
          </div>
          <ChevronRight size={16} style={{ color: "var(--accent-ink)" }} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => go(prevWeek)} aria-label="Previous week" style={navBtn}><ChevronLeft size={18} /></button>
        <div style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{weekLabel(weekStart)}</div>
        <button onClick={() => go(nextWeek)} aria-label="Next week" style={navBtn}><ChevronRight size={18} /></button>
      </div>

      {byDay.length === 0 && (
        <Card><div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "12px 0" }}>No classes scheduled this week.</div></Card>
      )}

      {byDay.map(([date, list]) => (
        <div key={date}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: date === today ? "var(--accent-ink)" : "var(--text-secondary)", margin: "4px 2px 8px" }}>
            {dayLabel(date, { weekday: "long", day: "numeric", month: "short" })}{date === today ? " · Today" : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map((c) => {
              const full = c.filled >= c.capacity;
              const busy = pendingId === c.id;
              const locked = !c.booked && !canBook;
              return (
                <Card key={c.id} style={{ padding: "12px 14px", borderLeft: `4px solid ${c.color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
                        {c.startTime}–{c.endTime}{c.instructor ? ` · ${c.instructor}` : ""}
                      </div>
                      <div style={{ fontSize: 11.5, color: full && !c.booked ? "var(--accent-ink)" : "var(--text-tertiary)", marginTop: 2 }}>
                        {c.location ? `${c.location} · ` : ""}{c.filled}/{c.capacity}{full ? " · Full" : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => act(c)}
                      disabled={busy || (!c.booked && full)}
                      style={{
                        flexShrink: 0,
                        height: 36,
                        padding: "0 14px",
                        borderRadius: 999,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: busy || (!c.booked && full) ? "default" : "pointer",
                        border: c.booked ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                        background: c.booked ? "var(--accent-soft)" : full || locked ? "transparent" : "var(--accent)",
                        color: c.booked ? "var(--accent-ink)" : full || locked ? "var(--text-tertiary)" : "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      {busy ? "…" : c.booked ? (<><Check size={14} /> Booked</>) : full ? "Full" : locked ? (<><Lock size={13} /> Book</>) : "Book"}
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
