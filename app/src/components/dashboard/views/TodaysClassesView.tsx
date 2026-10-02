import Link from "next/link";
import type { TodayClass } from "@/lib/dashboard";
import { formatTime } from "@/lib/utils";

export function TodaysClassesView({ classes }: { classes: TodayClass[] }) {
  if (classes.length === 0) {
    return <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No classes scheduled today.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {classes.map((c) => {
        const full = c.booked >= c.capacity;
        const pct = c.capacity > 0 ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0;
        return (
          <Link
            key={c.id}
            href="/timetable"
            style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }}
          >
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, color: "var(--text-primary)", minWidth: 62 }}>{formatTime(c.time)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{c.name}</div>
              <div style={{ marginTop: 6, height: 5, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: full ? "#22c55e" : "var(--accent)" }} />
              </div>
              {c.instructor && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4 }}>{c.instructor}</div>}
            </div>
            <div style={{ fontSize: 13, color: full ? "#22c55e" : "var(--text-secondary)", fontWeight: 600, whiteSpace: "nowrap" }}>
              {c.booked}/{c.capacity}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
