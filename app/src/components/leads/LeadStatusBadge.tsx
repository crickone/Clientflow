import { Badge } from "@/components/ui/Badge";
import type { LeadStatus } from "@/lib/leads";

const CONFIG: Record<LeadStatus, {
  label: string;
  tone: "neutral" | "amber" | "green" | "red";
}> = {
  new: { label: "New", tone: "amber" },
  contacted: { label: "Contacted", tone: "neutral" },
  replied: { label: "Replied", tone: "green" },
  booked: { label: "Booked", tone: "green" },
  lost: { label: "Lost", tone: "red" },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const cfg = CONFIG[status];
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}
