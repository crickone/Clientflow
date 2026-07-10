"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Stethoscope, MessageSquare, Sparkles, Home } from "lucide-react";

const TABS = [
  { href: "/training", label: "Overview", icon: Home, match: (p: string) => p === "/training" },
  { href: "/training/module", label: "Modules", icon: BookOpen, match: (p: string) => p.startsWith("/training/module") },
  { href: "/training/lookup", label: "Condition lookup", icon: Stethoscope, match: (p: string) => p.startsWith("/training/lookup") },
  { href: "/training/roleplay", label: "Roleplay", icon: MessageSquare, match: (p: string) => p.startsWith("/training/roleplay") },
  { href: "/training/drill", label: "Script drills", icon: Sparkles, match: (p: string) => p.startsWith("/training/drill") },
];

export function TrainingNav() {
  const pathname = usePathname() || "";
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--hairline)",
        marginBottom: 32,
        flexWrap: "wrap",
      }}
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "-0.005em",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              borderBottom: active ? "1px solid var(--text-primary)" : "1px solid transparent",
              marginBottom: -1,
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
