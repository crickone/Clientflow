import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { CardValue } from "@/components/ui/Card";

export function KpiTile({
  value,
  sub,
  delta,
  accent,
  goodWhen = "up",
}: {
  value: string;
  sub?: string;
  /** Percentage change vs the previous period; null hides the chip. */
  delta?: number | null;
  accent?: boolean;
  /** Which direction of change is good; lower-is-better metrics pass "down". */
  goodWhen?: "up" | "down";
}) {
  const up = (delta ?? 0) >= 0;
  const good = goodWhen === "down" ? (delta ?? 0) <= 0 : up;
  // A tile with no figure yet ("No wins yet") reads as a sentence, not as a
  // giant uppercase number.
  const isFigure = /\d/.test(value);
  return (
    <>
      {isFigure ? (
        <CardValue style={{ color: accent ? "var(--accent)" : undefined }}>{value}</CardValue>
      ) : (
        <div style={{ color: "var(--text-secondary)", fontSize: 15, fontWeight: 500, padding: "6px 0 2px" }}>{value}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {delta != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 12,
              fontWeight: 600,
              color: good ? "#22c55e" : "#ef4444",
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
