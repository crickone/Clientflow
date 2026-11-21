/** Plain-word labels for the Businesses list. Pure, so they are tested without a browser. */

const STAGE_WORDS: Record<string, string> = {
  active: "Live",
  onboarding: "Setting up",
  trial: "Trial",
  at_risk: "At risk",
  churned: "Churned",
  not_launched: "Not launched",
  internal: "Internal",
};

export function stageLabel(stage: string | null | undefined): string {
  return (stage && STAGE_WORDS[stage]) || "-";
}

const BILLING_WORDS: Record<string, string> = {
  active: "Paying",
  past_due: "Past due",
  pending_payment: "Awaiting payment",
  cancelled: "Cancelled",
  suspended: "Suspended",
};

export function billingLabel(row: { exempt: boolean; status: string | null; stage?: string | null }): string {
  if (row.stage === "internal") return "Internal";
  if (row.exempt) return "Free · agency client";
  return (row.status && BILLING_WORDS[row.status]) || "No billing";
}

/** Churn risk means nothing for a business that has not launched or is ours. */
export function riskShown(stage: string | null | undefined): boolean {
  return stage !== "not_launched" && stage !== "internal";
}

/** "5m", "2h", "1d", "3w": how long ago, for the Last login column. */
export function relTime(ms: number | null | undefined, now: number = Date.now()): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-";
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
