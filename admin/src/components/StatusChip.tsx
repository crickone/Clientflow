import { billingLabel } from "@/lib/labels";

/** Billing in plain words: Paying, Past due, Free · agency client, Internal. */
export function StatusChip({ status, exempt, stage }: { status: string | null; exempt?: boolean; stage?: string | null }) {
  const label = billingLabel({ exempt: Boolean(exempt), status, stage });
  const neutral = stage === "internal" || exempt || !status;
  return <span className={`chip ${neutral ? "exempt" : status}`}>{label}</span>;
}
