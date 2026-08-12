import { Card } from "@/components/ui/Card";
import type { AiLedgerRow } from "@/lib/ai/creditsLedger";

/**
 * Read-only AI-credits widget on the Agents overview: how much of the free
 * monthly allowance is used, the prepaid credit balance that covers overflow,
 * and recent ledger movements. Server component (pure display) — it renders the
 * client `Card` as a child. Top-up is deferred to Phase 3 (CreatePay); until
 * then a business out of credits is topped up by an admin from the console.
 */
const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const NEGATIVE = "#f0809a"; // soft red for a negative (debt) balance

export function AiCreditsCard({
  monthCents,
  freeTrancheCents,
  balanceCents,
  ledger,
}: {
  monthCents: number;
  freeTrancheCents: number;
  balanceCents: number;
  ledger: AiLedgerRow[];
}) {
  const usedPct = freeTrancheCents > 0 ? Math.min(100, Math.round((monthCents / freeTrancheCents) * 100)) : 100;
  const overTranche = monthCents >= freeTrancheCents;

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          AI credits
        </h3>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {eur(Math.round(monthCents))} of {eur(freeTrancheCents)} free allowance used this month
        </span>
      </div>

      {/* free-allowance meter */}
      <div style={{ height: 6, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
        <div
          style={{
            width: `${usedPct}%`,
            height: "100%",
            background: overTranche ? "var(--accent)" : "var(--accent-ink)",
            borderRadius: 999,
          }}
        />
      </div>

      <div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 4,
          }}
        >
          Credit balance
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: balanceCents < 0 ? NEGATIVE : "var(--text-primary)" }}>
          {eur(balanceCents)}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
        Your first {eur(freeTrancheCents)} of AI usage each month is free. Beyond that, it draws down prepaid credits
        {overTranche && balanceCents <= 0 ? " — you're out, so an admin can add credits (self-serve top-up is coming)." : "."}
      </p>

      {ledger.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--grid)", paddingTop: 14 }}>
          {ledger.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
              <span style={{ color: "var(--text-secondary)", textTransform: "capitalize" }}>
                {r.reason.replace(/_/g, " ")}
              </span>
              <span style={{ color: r.deltaCents >= 0 ? "var(--accent-ink)" : "var(--text-secondary)" }}>
                {r.deltaCents >= 0 ? "+" : "−"}
                {eur(Math.abs(r.deltaCents))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
