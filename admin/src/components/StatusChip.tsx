export function StatusChip({ status, exempt }: { status: string | null; exempt?: boolean }) {
  if (!status) return <span className="chip exempt">no billing</span>;
  if (exempt) return <span className="chip exempt">agency</span>;
  const label: Record<string, string> = {
    pending_payment: "awaiting payment", active: "active", past_due: "past due",
    suspended: "suspended", cancelled: "cancelled",
  };
  return <span className={`chip ${status}`}>{label[status] ?? status}</span>;
}
