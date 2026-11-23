/** Shared status labels for the ads manager (no server-only: client components use it). */
export const AD_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  launching: { label: "Launching", tone: "info" },
  active: { label: "Running", tone: "success" },
  in_review: { label: "In review", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  paused: { label: "Paused", tone: "warning" },
  error: { label: "Needs attention", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
};

/**
 * The status to show for a campaign: a live campaign whose ads Meta is still
 * checking (or has refused) shows that instead of "Running", as Ads Manager does.
 */
export function shownStatus(status: string, reviewState: string | null | undefined): string {
  return status === "active" && (reviewState === "in_review" || reviewState === "rejected") ? reviewState : status;
}

export function money(amount: number | null | undefined, currency: string): string {
  if (amount == null) return "-";
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
