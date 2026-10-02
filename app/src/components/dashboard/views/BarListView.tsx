import Link from "next/link";

export type BarRow = { label: string; value: number; display?: string; sub?: string; href?: string };

export function BarListView({ rows, empty, max }: { rows: BarRow[]; empty: string; max?: number }) {
  if (rows.length === 0) {
    return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r, i) => {
        const label = (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
            {r.sub && <div style={{ fontSize: 11, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</div>}
          </div>
        );
        return (
          <div key={`${r.label}:${i}`} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 34%) 1fr minmax(32px, auto)", gap: 10, alignItems: "center" }}>
            {r.href ? <Link href={r.href} style={{ minWidth: 0 }}>{label}</Link> : label}
            <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, (r.value / top) * 100))}%`, height: "100%", background: "var(--accent)" }} />
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-primary)", textAlign: "right", fontWeight: 600 }}>{r.display ?? r.value}</div>
          </div>
        );
      })}
    </div>
  );
}
