const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function HeatmapView({ grid, empty }: { grid: number[][]; empty: string }) {
  const max = Math.max(0, ...grid.flat());
  if (max === 0) {
    return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 360, display: "grid", gridTemplateColumns: "32px repeat(24, 1fr)", gap: 2, alignItems: "center" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ fontSize: 10, color: "var(--text-tertiary)", textAlign: "left" }}>
            {h % 6 === 0 ? h : ""}
          </div>
        ))}
        {DAYS.map((d, r) => (
          <HeatRow key={d} day={d} row={grid[r] ?? []} max={max} />
        ))}
      </div>
    </div>
  );
}

function HeatRow({ day, row, max }: { day: string; row: number[]; max: number }) {
  return (
    <>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{day}</div>
      {Array.from({ length: 24 }, (_, h) => {
        const v = row[h] ?? 0;
        return (
          <div
            key={h}
            title={`${day} ${String(h).padStart(2, "0")}:00 - ${v}`}
            style={{ height: 18, borderRadius: 3, background: v > 0 ? "var(--accent)" : "var(--surface-2)", opacity: v > 0 ? Math.max(0.15, v / max) : 1 }}
          />
        );
      })}
    </>
  );
}
