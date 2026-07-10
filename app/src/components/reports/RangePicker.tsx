"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const PRESETS = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "3months", label: "Last 3 months" },
  { key: "year", label: "This year" },
] as const;

export function RangePicker() {
  const params = useSearchParams();
  const active = params.get("range") ?? "month";

  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 3,
        gap: 2,
        flexWrap: "wrap",
      }}
    >
      {PRESETS.map((p) => {
        const isActive = active === p.key;
        const next = new URLSearchParams(Array.from(params.entries()));
        if (p.key === "month") next.delete("range");
        else next.set("range", p.key);
        return (
          <Link
            key={p.key}
            href={`/reports${next.size ? "?" + next.toString() : ""}`}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius)",
              fontSize: 13,
              fontWeight: 500,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              background: isActive ? "var(--bg)" : "transparent",
              boxShadow: isActive ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s var(--ease)",
            }}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}

export { rangeFromKey } from "@/lib/reportsRange";
