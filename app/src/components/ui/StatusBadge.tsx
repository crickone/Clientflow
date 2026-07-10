import { Badge } from "./Badge";

const STATUS: Record<string, { label: string; tone: "neutral" | "amber" | "green" | "red" }> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "red" },
  no_show: { label: "No-show", tone: "red" },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}
