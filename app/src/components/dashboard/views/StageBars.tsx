import type { LucideIcon } from "lucide-react";

import { WidgetEmpty } from "./WidgetEmpty";

export function StageBars({
  stages,
  empty,
  emptyIcon,
  emptyAction,
}: {
  stages: { id: number; name: string; count: number }[];
  empty: string;
  emptyIcon?: LucideIcon;
  emptyAction?: { href: string; label: string };
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  if (stages.every((s) => s.count === 0)) {
    return <WidgetEmpty text={empty} icon={emptyIcon} action={emptyAction} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {stages.map((s) => (
        <div key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 34%) 1fr 32px", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.name}
          </div>
          <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
            <div className="bar-grow" style={{ width: `${(s.count / max) * 100}%`, height: "100%", background: "var(--accent)" }} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-primary)", textAlign: "right", fontWeight: 600 }}>{s.count}</div>
        </div>
      ))}
    </div>
  );
}
