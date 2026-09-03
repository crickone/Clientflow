"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Content Studio nav. The home (`/content-studio`) is the hub — create tiles +
 * a unified, filterable work grid — so it needs no nav of its own. Every other
 * Content Studio route (the per-type lists, the create flows, the editors) gets
 * a single "back to Content Studio" link instead of the old 4-tab bar (which
 * duplicated the home's own filter tabs and was one of three competing tab
 * styles on screen).
 */
export function ContentStudioTabs() {
  const pathname = usePathname() ?? "";
  if (pathname === "/content-studio") return null;
  return (
    <Link
      href="/content-studio"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 24,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        textDecoration: "none",
        transition: "color 0.15s var(--ease)",
      }}
      className="cs-back"
    >
      <ArrowLeft size={14} />
      Content Studio
    </Link>
  );
}
