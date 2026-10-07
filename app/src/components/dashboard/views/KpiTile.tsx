import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { CardValue } from "@/components/ui/Card";
import { CountUp } from "@/components/motion/CountUp";
import { Sparkline } from "./Sparkline";

export function KpiTile({
  value,
  sub,
  delta,
  accent,
  goodWhen = "up",
  spark,
}: {
  value: string;
  sub?: string;
  /** Percentage change vs the previous period; null hides the chip. */
  delta?: number | null;
  accent?: boolean;
  /** Which direction of change is good; lower-is-better metrics pass "down". */
  goodWhen?: "up" | "down";
  /** Per-bucket values across the range; draws a trend line under the figure. */
  spark?: number[];
}) {
  const up = (delta ?? 0) >= 0;
  const good = goodWhen === "down" ? (delta ?? 0) <= 0 : up;
  // A tile with no figure yet ("No wins yet") reads as a sentence, not as a
  // giant uppercase number.
  const isFigure = /\d/.test(value);
  // A zero is greyed out so the figures that matter stand out on the grid.
  const isZero = /^[^\d]*0(?:[.,]0+)?%?$/.test(value.trim());
  return (
    <>
      {isFigure ? (
        <CardValue style={{ color: isZero ? "var(--text-tertiary)" : accent ? "var(--accent)" : undefined }}>
          <CountUp value={value} />
        </CardValue>
      ) : (
        <div style={{ color: "var(--text-secondary)", fontSize: 15, fontWeight: 500, padding: "6px 0 2px" }}>{value}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {delta != null && (
          <span className={`kpi-delta ${delta === 0 ? "kpi-delta--flat" : good ? "kpi-delta--good" : "kpi-delta--bad"}`}>
            {up ? <ArrowUpRight size={12} strokeWidth={2.25} /> : <ArrowDownRight size={12} strokeWidth={2.25} />}
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>{sub}</span>}
      </div>
      {spark && <Sparkline points={spark} />}
    </>
  );
}
