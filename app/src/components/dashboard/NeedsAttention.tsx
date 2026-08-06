import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";

import type { AttentionItem } from "@/lib/dashboard";

/** A row of actionable cards — only rendered when there's something to flag. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 11,
          color: "var(--text-tertiary)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        // Needs attention
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {items.map((it) => (
          <Link key={it.key} href={it.href} style={{ textDecoration: "none" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderRadius: "var(--radius)",
                border: `1px solid ${it.tone === "alert" ? "color-mix(in srgb, var(--accent) 45%, var(--hairline))" : "var(--hairline)"}`,
                background: it.tone === "alert" ? "color-mix(in srgb, var(--accent) 8%, var(--surface-1))" : "var(--surface-1)",
              }}
            >
              <AlertCircle size={18} strokeWidth={1.9} style={{ color: it.tone === "alert" ? "var(--accent)" : "var(--text-tertiary)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>{it.count}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 }}>{it.label}</div>
              </div>
              <ArrowRight size={15} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
