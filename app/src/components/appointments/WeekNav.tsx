"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, formatDate } from "@/lib/utils";

interface Props {
  weekStart: Date;
}

export function WeekNav({ weekStart }: Props) {
  const params = useSearchParams();
  const previous = addDays(weekStart, -7);
  const next = addDays(weekStart, 7);

  const isoOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const buildHref = (iso?: string) => {
    const u = new URLSearchParams(Array.from(params.entries()));
    if (iso) u.set("week", iso);
    else u.delete("week");
    return `/appointments${u.size ? "?" + u.toString() : ""}`;
  };

  const end = addDays(weekStart, 5);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Link
        href={buildHref(isoOf(previous))}
        style={{
          padding: 6,
          borderRadius: "var(--radius)",
          color: "var(--text-secondary)",
          display: "inline-flex",
        }}
      >
        <ChevronLeft size={16} />
      </Link>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          minWidth: 220,
          textAlign: "center",
          fontWeight: 500,
        }}
      >
        {formatDate(weekStart)} — {formatDate(end)}
      </div>
      <Link
        href={buildHref(isoOf(next))}
        style={{
          padding: 6,
          borderRadius: "var(--radius)",
          color: "var(--text-secondary)",
          display: "inline-flex",
        }}
      >
        <ChevronRight size={16} />
      </Link>
      <Link
        href={buildHref()}
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          marginLeft: 4,
          padding: "4px 10px",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
        }}
      >
        Today
      </Link>
    </div>
  );
}
