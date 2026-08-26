import type { CSSProperties, ReactNode } from "react";
import { ExternalLink, FileText } from "lucide-react";

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

/** A tappable card linking out to an attached document (uploaded plan/program). Plain <a> — no
 *  event handler, so (like Card/PageTitle above) it's safe to render from a Server Component too;
 *  it just also happens to get used from the client-only plan/program detail views. */
export function DocumentCard({ href, name, sub }: { href: string; name: string; sub?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)", flexShrink: 0 }}>
          <FileText size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{sub ?? "Tap to open"}</div>
        </div>
        <ExternalLink size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      </Card>
    </a>
  );
}
