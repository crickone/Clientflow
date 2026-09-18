"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * The tenant hub's tabs.
 *
 * Only tabs that exist are listed. The scope has nine;
 * Features, Data and Health arrive with their own slices, and listing them
 * early as empty shells would make the console look finished when it is not.
 */
const TABS = [
  { slug: "", label: "Overview" },
  { slug: "people", label: "People" },
  { slug: "integrations", label: "Integrations" },
  { slug: "money", label: "Money" },
  { slug: "timeline", label: "Timeline" },
] as const;

export function TenantTabs({ tenantId }: { tenantId: number }) {
  const pathname = usePathname() ?? "";
  const base = `/gyms/${tenantId}`;

  return (
    <nav
      aria-label="Business sections"
      style={{
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
        borderBottom: "1px solid var(--grid)",
        paddingBottom: 0,
      }}
    >
      {TABS.map((tab) => {
        const href = tab.slug ? `${base}/${tab.slug}` : base;
        const active = tab.slug ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={tab.slug || "overview"}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("tenant-tab", active && "tenant-tab--active")}
            style={{
              padding: "9px 14px",
              fontSize: 13.5,
              fontWeight: active ? 600 : 500,
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              textDecoration: "none",
              borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
