"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function FilterTabs() {
  const params = useSearchParams();
  const active = params.get("filter") ?? "all";

  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 3,
        gap: 2,
      }}
    >
      {TABS.map((t) => {
        const next = new URLSearchParams(Array.from(params.entries()));
        if (t.value === "all") next.delete("filter");
        else next.set("filter", t.value);
        const isActive = active === t.value;
        return (
          <Link
            key={t.value}
            href={`/clients${next.size ? "?" + next.toString() : ""}`}
            style={{
              padding: "6px 16px",
              borderRadius: "var(--radius)",
              fontSize: 13,
              fontWeight: 500,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              background: isActive ? "var(--bg)" : "transparent",
              boxShadow: isActive ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s var(--ease)",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
