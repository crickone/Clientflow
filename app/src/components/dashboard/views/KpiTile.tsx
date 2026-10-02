import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { CardValue } from "@/components/ui/Card";

export function KpiTile({
  value,
  sub,
  delta,
  accent,
}: {
  value: string;
  sub?: string;
  /** Percentage change vs the previous period; null hides the chip. */
  delta?: number | null;
  accent?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <>
      <CardValue style={{ color: accent ? "var(--accent)" : undefined }}>{value}</CardValue>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {delta != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 12,
              fontWeight: 600,
              color: up ? "#22c55e" : "#ef4444",
            }}
          >
            {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>{sub}</span>}
      </div>
    </>
  );
}
