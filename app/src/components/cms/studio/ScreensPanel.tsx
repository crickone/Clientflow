"use client";

import Link from "next/link";
import { FileText, Globe, Image as ImageIcon, Newspaper } from "lucide-react";

const HEADING: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".12em",
  color: "var(--text-tertiary)",
};

const MANAGE = [
  { key: "pages", label: "Pages & SEO", icon: FileText },
  { key: "blog", label: "Blog", icon: Newspaper },
  { key: "media", label: "Media", icon: ImageIcon },
  { key: "domains", label: "Domains", icon: Globe },
] as const;

/** Left rail: the site's other sections, then the pages you can edit here. */
export function ScreensPanel({
  siteSlug,
  pages,
  activePath,
  draftPaths,
  onNavigate,
}: {
  siteSlug: string;
  pages: { path: string; title: string }[];
  activePath: string;
  draftPaths: string[];
  onNavigate: (path: string) => void;
}) {
  const drafts = new Set(draftPaths);
  return (
    <aside
      style={{
        borderRight: "1px solid var(--hairline)",
        padding: 14,
        overflowY: "auto",
        background: "var(--surface-1)",
      }}
    >
      <div style={{ ...HEADING, marginBottom: 8 }}>Manage site</div>
      <div style={{ display: "grid", gap: 2, marginBottom: 18 }}>
        {MANAGE.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={`/cms/${siteSlug}/${key}`}
            className="nav-link"
            style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 6, fontSize: 13 }}
          >
            <Icon size={15} strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </div>

      <div style={{ ...HEADING, marginBottom: 10 }}>Screens</div>
      <div style={{ display: "grid", gap: 2 }}>
        {pages.map((p) => {
          const active = p.path === activePath;
          return (
            <button
              key={p.path}
              onClick={() => onNavigate(p.path)}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                background: active ? "var(--surface-2)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {p.title || p.path}
                {drafts.has(p.path) && (
                  <span
                    title="Unpublished draft"
                    style={{ width: 6, height: 6, borderRadius: "50%", background: "#d29922", flex: "none" }}
                  />
                )}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{p.path}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
