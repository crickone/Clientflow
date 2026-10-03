/** Shared status labels for the ads manager (no server-only: client components use it). */
export const AD_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  launching: { label: "Launching", tone: "info" },
  active: { label: "Running", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  error: { label: "Needs attention", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
};

export function money(amount: number | null | undefined, currency: string): string {
  if (amount == null) return "-";
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
