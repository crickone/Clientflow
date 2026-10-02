import Link from "next/link";
import { REQUIREMENT_CTA } from "@/lib/dashboard/requirements";
import type { Requirement } from "@/lib/dashboard/types";

export function RequirementCta({ requirement }: { requirement: Requirement }) {
  const c = REQUIREMENT_CTA[requirement];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <div style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 14 }}>{c.title}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>{c.body}</div>
      <Link
        href={c.href}
        style={{ marginTop: 6, fontSize: 13, fontWeight: 500, color: "var(--accent)", border: "1px solid var(--hairline)", borderRadius: 8, padding: "6px 12px" }}
      >
        {c.action}
      </Link>
    </div>
  );
}
