import { Clock } from "lucide-react";

export function CollectingNote({ since }: { since: Date | null }) {
  const text = since
    ? `Collecting since ${since.toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" })}`
    : "Collecting starts with the first event";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-tertiary)", fontSize: 12, marginBottom: 10 }}>
      <Clock size={12} /> {text}
    </div>
  );
}
