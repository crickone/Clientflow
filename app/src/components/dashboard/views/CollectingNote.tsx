import { Clock } from "lucide-react";

export function CollectingNote({ since }: { since: Date }) {
  const label = since.toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-tertiary)", fontSize: 12, marginBottom: 10 }}>
      <Clock size={12} /> Collecting since {label}
    </div>
  );
}
