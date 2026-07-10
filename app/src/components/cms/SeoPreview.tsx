"use client";

import { Card, CardLabel } from "@/components/ui/Card";

function clamp(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Counter({ value, max }: { value: number; max: number }) {
  const over = value > max;
  return (
    <span style={{ fontSize: 11, color: over ? "#dc2626" : "var(--text-tertiary)" }}>
      {value}/{max}
      {over ? " — too long" : ""}
    </span>
  );
}

/** Live Google + social-card preview for SEO fields. */
export function SeoPreview({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}) {
  const t = title || "Untitled — set an SEO title";
  const d =
    description ||
    "No meta description yet. Search engines may use page content instead.";
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* relative */
  }

  return (
    <Card style={{ display: "grid", gap: 14, background: "var(--surface-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <CardLabel>Search preview</CardLabel>
        <div style={{ display: "flex", gap: 12 }}>
          <Counter value={title.length} max={60} />
          <Counter value={description.length} max={160} />
        </div>
      </div>

      {/* Google result */}
      <div style={{ background: "#fff", borderRadius: 8, padding: "12px 14px", maxWidth: 520 }}>
        <div style={{ fontSize: 12, color: "#202124" }}>{host}</div>
        <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 2, wordBreak: "break-all" }}>{url}</div>
        <div style={{ color: "#1a0dab", fontSize: 19, lineHeight: 1.3, fontFamily: "arial, sans-serif" }}>
          {clamp(t, 60)}
        </div>
        <div style={{ color: "#4d5156", fontSize: 13, lineHeight: 1.5, fontFamily: "arial, sans-serif" }}>
          {clamp(d, 160)}
        </div>
      </div>

      {/* Social card */}
      <div style={{ maxWidth: 420, border: "1px solid var(--hairline)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
        <div style={{ aspectRatio: "1.91/1", background: "linear-gradient(135deg,#1b1b1f,#2a2a30)", display: "grid", placeItems: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
          social image
        </div>
        <div style={{ padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase" }}>{host}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{clamp(t, 70)}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{clamp(d, 120)}</div>
        </div>
      </div>
    </Card>
  );
}
