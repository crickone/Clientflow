import type { ReactNode } from "react";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /**
   * Drop the 32px gap this header normally leaves under itself. For a header
   * rendered INSIDE a container that owns its own padding — the agent detail
   * page's hologram hero is the one caller today — where that gap lands as
   * dead space inside the box rather than as separation from what follows.
   */
  flush?: boolean;
}

export function PageHeader({ eyebrow, title, subtitle, actions, flush }: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: 24,
        flexWrap: "wrap",
        marginBottom: flush ? 0 : 32,
      }}
    >
      <div>
        {eyebrow && (
          <div
            style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 11,
              color: "var(--accent)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 12,
              fontWeight: 400,
            }}
          >
            // {eyebrow}
          </div>
        )}
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: "clamp(32px, 4vw, 44px)",
            fontWeight: 400,
            letterSpacing: "-0.005em",
            color: "var(--text-primary)",
            lineHeight: 1.05,
            textTransform: "uppercase",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              color: "var(--text-tertiary)",
              fontSize: 12,
              letterSpacing: "0.01em",
              marginTop: 12,
              maxWidth: 640,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
