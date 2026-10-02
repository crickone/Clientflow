import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatTime } from "@/lib/utils";

export interface ScheduleItem {
  id: number;
  startTime: string;
  status: string;
  clientName: string;
  therapies: { id: number; name: string; colourHex: string }[];
}

export function TodaysScheduleView({ items, empty }: { items: ScheduleItem[]; empty: string }) {
  if (items.length === 0) {
    return <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((a) => (
        <Link
          key={a.id}
          href={`/appointments/${a.id}`}
          style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }}
        >
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, color: "var(--text-primary)", minWidth: 70 }}>{formatTime(a.startTime)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{a.clientName}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {a.therapies.map((t) => (
                <Badge key={t.id} colour={t.colourHex}>
                  {t.name}
                </Badge>
              ))}
            </div>
          </div>
          <StatusBadge status={a.status} />
        </Link>
      ))}
    </div>
  );
}
