"use client";

/**
 * Horizontally-scrollable day-pill switcher — shared by the nutrition plan
 * and workout program detail views for multi-day plans. Read-only sibling of
 * the day tabs in the admin's DetailedBuilder (same pill styling), minus the
 * add/remove/edit affordances (a client never edits their own plan). Self-
 * marked "use client" (matching Button.tsx's own convention in this repo)
 * since it renders an interactive onClick — it must only ever be rendered
 * from within an already-"use client" component tree.
 */
export function DayTabs({
  labels,
  active,
  onChange,
}: {
  labels: string[];
  active: number;
  onChange: (index: number) => void;
}) {
  if (labels.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
      {labels.map((label, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            style={{
              flexShrink: 0,
              padding: "7px 14px",
              borderRadius: "var(--radius)",
              border: isActive ? "1px solid var(--accent)" : "1px solid var(--hairline)",
              background: isActive ? "var(--accent-soft)" : "transparent",
              color: isActive ? "var(--accent-ink)" : "var(--text-secondary)",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
