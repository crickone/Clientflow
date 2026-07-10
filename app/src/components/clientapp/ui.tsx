import type { CSSProperties, ReactNode } from "react";

export function euros(cents: number) {
  return `€${(cents / 100).toLocaleString("en-IE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Date-only ISO (YYYY-MM-DD) → "Mon 14 Jul". Locale date-only is hydration-safe. */
export function dayLabel(iso: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IE", opts ?? { weekday: "short", day: "numeric", month: "short" });
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", padding: 16, ...style }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", margin: "4px 2px" }}>
      {children}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase", color: "var(--text-primary)" }}>{children}</h1>
      {sub && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
