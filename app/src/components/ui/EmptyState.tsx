import type { ReactNode } from "react";

interface Props {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, message, icon, action }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "72px 24px",
        background: "var(--surface-1)",
        border: "1px dashed var(--hairline)",
        borderRadius: "var(--radius)",
        textAlign: "center",
        gap: 14,
      }}
    >
      {icon && <div style={{ color: "var(--text-tertiary)" }}>{icon}</div>}
      <div
        style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontSize: 22,
          color: "var(--text-primary)",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      {message && (
        <div style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 480 }}>
          {message}
        </div>
      )}
      {action}
    </div>
  );
}
