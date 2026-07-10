"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/automations/TriggerListView";

interface SentRow {
  id: number;
  triggerName: string;
  channel: string;
  subject: string | null;
  sentTo: string | null;
  status: string;
  sentAt: number;
}

function fmtDate(ms: number) {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  const t = `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
  return `${d.toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" })} · ${t}`;
}

export function SentMessagesView({ sent }: { sent: SentRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return sent;
    return sent.filter(
      (s) =>
        s.triggerName.toLowerCase().includes(query) ||
        (s.subject ?? "").toLowerCase().includes(query) ||
        (s.sentTo ?? "").toLowerCase().includes(query),
    );
  }, [sent, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs active="sent" />
      <div style={{ maxWidth: 280 }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
      </div>
      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ ...row, ...headRow }}>
              <div>Trigger name</div>
              <div>Subject</div>
              <div>Channel</div>
              <div>Sent to</div>
              <div>Status</div>
              <div>Sent date</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5 }}>
                No messages have been sent via automation yet.
              </div>
            )}
            {filtered.map((s) => (
              <div key={s.id} style={row}>
                <div style={{ color: "var(--text-primary)" }}>{s.triggerName}</div>
                <div style={cellMuted}>{s.subject ?? "—"}</div>
                <div style={cellMuted}>{s.channel}</div>
                <div style={cellMuted}>{s.sentTo ?? "—"}</div>
                <div style={cellMuted}>{s.status}</div>
                <div style={cellMuted}>{fmtDate(s.sentAt)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.4fr 1.6fr 0.8fr 1.2fr 0.8fr 1.2fr",
  gap: 12,
  padding: "12px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const cellMuted: React.CSSProperties = { color: "var(--text-secondary)", fontSize: 12.5 };
