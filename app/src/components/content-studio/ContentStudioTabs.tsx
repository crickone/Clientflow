"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, FolderOpen, Image as ImageIcon, Video } from "lucide-react";

const TABS = [
  { href: "/content-studio/videos", label: "Videos", icon: Video },
  { href: "/content-studio/images", label: "Images", icon: ImageIcon },
  { href: "/content-studio/blogs", label: "Blogs", icon: FileText },
  { href: "/content-studio/library", label: "Library", icon: FolderOpen },
] as const;

export function ContentStudioTabs() {
  const pathname = usePathname() ?? "";
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--hairline)",
        marginBottom: 28,
      }}
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 18px",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              borderBottom: `2px solid ${
                active ? "var(--text-primary)" : "transparent"
              }`,
              marginBottom: -1,
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "-0.005em",
              textDecoration: "none",
              transition: "color 0.18s var(--ease), border-color 0.18s var(--ease)",
            }}
          >
            <Icon size={15} strokeWidth={1.75} />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
