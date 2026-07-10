"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { AttendanceStats, ClientActivityRow } from "@/lib/attendance";

const PRESETS: { key: string; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "ytd", label: "Year to date" },
];

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

export function AttendanceDashboard({
  range,
  from,
  to,
  today,
  stats,
  activity,
}: {
  range: string;
  from: string;
  to: string;
  today: string;
  stats: AttendanceStats;
  activity: ClientActivityRow[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const attendanceRate =
    stats.bookings > 0 ? Math.round((stats.attended / stats.bookings) * 100) : null;

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return activity
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter((r) => (query ? r.name.toLowerCase().includes(query) : true));
  }, [activity, q, status]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* range presets */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => router.push(`/attendance?range=${p.key}`)}
              style={{
                padding: "8px 16px",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontFamily: "var(--font-mono), monospace",
                background: range === p.key ? "var(--surface-2)" : "transparent",
                color: range === p.key ? "var(--text-primary)" : "var(--text-tertiary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
          {fmtDate(from)} – {fmtDate(to)}
        </span>
        <Link href={`/attendance/bookings?from=${from}&to=${to}`} style={{ marginLeft: "auto" }}>
          <Button variant="outline" size="sm">
            View all bookings
            <ArrowUpRight size={14} />
          </Button>
        </Link>
      </div>

      {/* stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
        }}
      >
        <StatCard
          label="Bookings"
          value={stats.bookings}
          foot={
            stats.changePct === null ? (
              <span style={{ color: "var(--text-tertiary)" }}>no prior period</span>
            ) : (
              <ChangeBadge pct={stats.changePct} prev={stats.prevBookings} />
            )
          }
        />
        <StatCard label="Attended" value={stats.attended} foot={<span style={{ color: "var(--text-tertiary)" }}>checked in</span>} />
        <StatCard label="No-shows" value={stats.noShow} foot={<span style={{ color: "var(--text-tertiary)" }}>marked absent</span>} />
        <StatCard
          label="Attendance rate"
          value={attendanceRate === null ? "—" : `${attendanceRate}%`}
          foot={<span style={{ color: "var(--text-tertiary)" }}>attended / booked</span>}
        />
      </div>

      {/* daily chart */}
      <DailyChart daily={stats.daily} />

      {/* client activity */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: 16,
              textTransform: "uppercase",
              letterSpacing: "0.02em",
            }}
          >
            Client activity
          </h3>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{filtered.length} clients</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ width: 220 }}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
              <option value="all">All statuses</option>
              <option value="active">Currently active</option>
              <option value="inactive">Inactive</option>
              <option value="never">Never active</option>
            </select>
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1.4fr 1fr",
              gap: 8,
              padding: "10px 16px",
              borderBottom: "1px solid var(--hairline)",
              background: "var(--surface-1)",
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono), monospace",
            }}
          >
            <div>Client</div>
            <div>Status</div>
            <div>Last session</div>
            <div style={{ textAlign: "right" }}>Sessions</div>
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
              No clients match.
            </div>
          )}
          {filtered.slice(0, 200).map((r) => (
            <div
              key={r.clientId}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1.4fr 1fr",
                gap: 8,
                padding: "11px 16px",
                borderBottom: "1px solid var(--hairline)",
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
              <div>
                <StatusPill status={r.status} />
              </div>
              <div style={{ color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.lastSessionDate ? (
                  <>
                    {r.lastSessionName}{" "}
                    <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
                      · {fmtDate(r.lastSessionDate)}
                    </span>
                  </>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>—</span>
                )}
              </div>
              <div
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono), monospace",
                  color: r.sessionsInRange > 0 ? "var(--text-primary)" : "var(--text-tertiary)",
                }}
              >
                {r.sessionsInRange}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, foot }: { label: string; value: number | string; foot: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: "16px 18px",
        background: "var(--surface-1)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-mono), monospace",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 30, fontFamily: "var(--font-heading), sans-serif", lineHeight: 1.2, margin: "4px 0 2px" }}>
        {value}
      </div>
      <div style={{ fontSize: 12 }}>{foot}</div>
    </div>
  );
}

function ChangeBadge({ pct, prev }: { pct: number; prev: number }) {
  const up = pct >= 0;
  const color = up ? "#22c55e" : "#ef4444";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color }}>
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {up ? "+" : ""}
      {Math.round(pct)}%
      <span style={{ color: "var(--text-tertiary)" }}>vs {prev} prior</span>
    </span>
  );
}

function StatusPill({ status }: { status: ClientActivityRow["status"] }) {
  const map = {
    active: { label: "Active", bg: "rgba(34,197,94,0.14)", fg: "#22c55e" },
    inactive: { label: "Inactive", bg: "rgba(234,179,8,0.14)", fg: "#eab308" },
    never: { label: "Never", bg: "rgba(255,255,255,0.06)", fg: "var(--text-tertiary)" },
  }[status];
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
        background: map.bg,
        color: map.fg,
      }}
    >
      {map.label}
    </span>
  );
}

function DailyChart({ daily }: { daily: { date: string; count: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const total = daily.reduce((s, d) => s + d.count, 0);
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: "16px 18px",
        background: "var(--surface-1)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div
          style={{
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          Bookings per day
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{total} total</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, overflowX: "auto" }}>
        {daily.map((d) => (
          <div
            key={d.date}
            title={`${fmtDate(d.date)}: ${d.count}`}
            style={{
              flex: "1 0 4px",
              minWidth: 4,
              height: `${(d.count / max) * 100}%`,
              minHeight: d.count > 0 ? 3 : 1,
              background: d.count > 0 ? "var(--accent)" : "var(--hairline)",
              borderRadius: 2,
              alignSelf: "flex-end",
            }}
          />
        ))}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
