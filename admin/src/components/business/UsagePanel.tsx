import type { ModuleUsage } from "@/lib/types";

/** Which modules they open, last 30 days, with the change on the month before. */
export function UsagePanel({ modules }: { modules: ModuleUsage[] }) {
  const max = Math.max(1, ...modules.map((m) => m.hits));
  const used = modules.filter((m) => m.hits > 0 || m.prevHits > 0).sort((a, b) => b.hits - a.hits);
  if (used.length === 0) return <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>No activity recorded yet. Counting started with this release.</p>;
  return (
    <ul className="usage">
      {used.map((m) => {
        const delta = m.prevHits === 0 ? null : Math.round(((m.hits - m.prevHits) / m.prevHits) * 100);
        return (
          <li key={m.key}>
            <span className="usage-label">{m.label}</span>
            <span className="usage-bar"><i style={{ width: `${(m.hits / max) * 100}%` }} /></span>
            <span className="usage-n">{m.hits}</span>
            <span className="usage-delta" style={{ color: delta === null ? "var(--text-tertiary)" : delta < 0 ? "var(--red)" : "var(--green)" }}>{delta === null ? "new" : `${delta > 0 ? "+" : ""}${delta}%`}</span>
          </li>
        );
      })}
      <li className="usage-unused">Not opened: {modules.filter((m) => m.hits === 0 && m.prevHits === 0).map((m) => m.label).join(", ") || "none"}</li>
    </ul>
  );
}
