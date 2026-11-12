import type { Risk } from "@/lib/types";

export function RiskCard({ risk }: { risk: Risk }) {
  const colour = risk.level === "high" ? "var(--red)" : risk.level === "medium" ? "var(--amber)" : "var(--green)";
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 34, lineHeight: 1, color: colour, fontVariantNumeric: "tabular-nums" }}>{risk.score}</div>
      <div style={{ fontSize: 13.5 }}>
        <div style={{ color: colour, textTransform: "capitalize", fontWeight: 500 }}>{risk.level} risk</div>
        {risk.reasons.length === 0 ? <div style={{ color: "var(--text-secondary)" }}>Nothing points to churn.</div> : <ul style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--text-secondary)" }}>{risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      </div>
    </div>
  );
}
