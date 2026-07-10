"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarRange, List } from "lucide-react";

export function ViewToggle() {
  const params = useSearchParams();
  const view = params.get("view") ?? "week";
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 3,
        gap: 2,
      }}
    >
      {[
        { v: "week", label: "Week", Icon: CalendarRange },
        { v: "list", label: "List", Icon: List },
      ].map(({ v, label, Icon }) => {
        const active = view === v;
        const next = new URLSearchParams(Array.from(params.entries()));
        if (v === "week") next.delete("view");
        else next.set("view", v);
        return (
          <Link
            key={v}
            href={`/appointments${next.size ? "?" + next.toString() : ""}`}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius)",
              fontSize: 13,
              fontWeight: 500,
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              background: active ? "var(--bg)" : "transparent",
              boxShadow: active ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s var(--ease)",
            }}
          >
            <Icon size={14} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
