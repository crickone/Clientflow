import type { ReactNode } from "react";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: 24,
        flexWrap: "wrap",
        marginBottom: 32,
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
