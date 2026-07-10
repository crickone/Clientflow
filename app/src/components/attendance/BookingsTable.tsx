"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, X } from "lucide-react";

import { Input } from "@/components/ui/Input";
import type { BookingRow } from "@/lib/attendance";
import { cancelBookingAction, setAttendanceAction } from "@/app/attendance/actions";

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUSES = [
  { key: "all", label: "All statuses" },
  { key: "booked", label: "Booked" },
  { key: "attended", label: "Attended" },
  { key: "no_show", label: "No-show" },
  { key: "cancelled", label: "Cancelled" },
];

export function BookingsTable({
  rows,
  from,
  to,
  status,
  q,
}: {
  rows: BookingRow[];
  from: string;
  to: string;
  status: string;
  q: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");

  const push = (next: Record<string, string>) => {
    const sp = new URLSearchParams({ from, to, status, ...next });
    router.push(`/attendance/bookings?${sp.toString()}`);
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter(
      (r) => r.clientName.toLowerCase().includes(query) || r.sessionName.toLowerCase().includes(query),
    );
  }, [rows, search]);

  const setStatus = (bookingId: number, next: "booked" | "attended" | "no_show") =>
    start(async () => {
      await setAttendanceAction(bookingId, next);
      router.refresh();
    });
  const cancel = (bookingId: number) =>
    start(async () => {
      await cancelBookingAction(bookingId);
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={filterLabel}>
          From
          <input type="date" value={from} onChange={(e) => push({ from: e.target.value })} style={dateInput} />
        </label>
        <label style={filterLabel}>
          To
          <input type="date" value={to} onChange={(e) => push({ to: e.target.value })} style={dateInput} />
        </label>
        <select value={status} onChange={(e) => push({ status: e.target.value })} style={dateInput}>
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <div style={{ width: 240, marginLeft: "auto" }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client or session…" />
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{filtered.length} bookings</div>

      {/* table */}
      <div
        style={{
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ ...gridRow, ...headRow }}>
              <div>Client</div>
              <div>Session</div>
              <div>Session date</div>
              <div>Booked</div>
              <div>Status</div>
              <div style={{ textAlign: "right" }}>Attendance</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
                No bookings in this range.
              </div>
            )}
            {filtered.map((r) => {
              const cancelled = r.status === "cancelled";
              return (
                <div key={r.bookingId} style={{ ...gridRow, opacity: cancelled ? 0.55 : 1 }}>
                  <div style={cellClip}>{r.clientName}</div>
                  <div style={cellClip}>{r.sessionName}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
                    {fmtDate(r.sessionDate)}{" "}
                    <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
                      {r.startTime}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12, fontFamily: "var(--font-mono), monospace" }}>
                    {fmtDateTime(r.bookedOn)}
                  </div>
                  <div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    {!cancelled ? (
                      <>
                        <AttButton
                          active={r.status === "attended"}
                          activeColor="#22c55e"
                          title="Mark attended"
                          disabled={pending}
                          onClick={() => setStatus(r.bookingId, r.status === "attended" ? "booked" : "attended")}
                        >
                          <Check size={14} />
                        </AttButton>
                        <AttButton
                          active={r.status === "no_show"}
                          activeColor="#ef4444"
                          title="Mark no-show"
                          disabled={pending}
                          onClick={() => setStatus(r.bookingId, r.status === "no_show" ? "booked" : "no_show")}
                        >
                          <X size={14} />
                        </AttButton>
                        <button
                          onClick={() => cancel(r.bookingId)}
                          disabled={pending}
                          title="Cancel booking"
                          aria-label="Cancel booking"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--text-tertiary)",
                            cursor: "pointer",
                            display: "inline-flex",
                            padding: 4,
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setStatus(r.bookingId, "booked")}
                        disabled={pending}
                        style={{
                          background: "transparent",
                          border: "1px solid var(--hairline)",
                          borderRadius: "var(--radius)",
                          color: "var(--text-secondary)",
                          cursor: "pointer",
                          fontSize: 11,
                          padding: "4px 10px",
                        }}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function AttButton({
  children,
  active,
  activeColor,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  activeColor: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        border: active ? `1px solid ${activeColor}` : "1px solid var(--hairline)",
        background: active ? activeColor : "transparent",
        color: active ? "#04140a" : "var(--text-tertiary)",
      }}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    booked: { label: "Booked", bg: "rgba(59,130,246,0.14)", fg: "#60a5fa" },
    attended: { label: "Attended", bg: "rgba(34,197,94,0.14)", fg: "#22c55e" },
    no_show: { label: "No-show", bg: "rgba(239,68,68,0.14)", fg: "#ef4444" },
    cancelled: { label: "Cancelled", bg: "rgba(255,255,255,0.06)", fg: "var(--text-tertiary)" },
  };
  const m = map[status] ?? map.booked;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        fontFamily: "var(--font-mono), monospace",
        padding: "2px 8px",
        borderRadius: 5,
        background: m.bg,
        color: m.fg,
      }}
    >
      {m.label}
    </span>
  );
}

const gridRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 1.4fr 1.1fr 1.1fr 0.9fr 1.1fr",
  gap: 10,
  padding: "11px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const cellClip: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const filterLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "var(--text-tertiary)",
};
const dateInput: React.CSSProperties = {
  height: 38,
  padding: "0 10px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
