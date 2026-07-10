import Link from "next/link";
import { ChevronRight, Mail, Phone } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { clientHistory, clientMembership } from "@/lib/clientApp";
import { Card, dayLabel, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { LogoutButton } from "@/components/clientapp/LogoutButton";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; color: string }> = {
  attended: { label: "Attended", color: "#22c55e" },
  no_show: { label: "Missed", color: "#f87171" },
  booked: { label: "Booked", color: "var(--text-tertiary)" },
};

export default async function ClientProfilePage() {
  const { clientId, client } = requireClientPage();
  const m = clientMembership(clientId);
  const history = clientHistory(clientId, 12);
  const initials = `${client.firstName?.[0] ?? ""}${client.lastName?.[0] ?? ""}`.toUpperCase();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle>Profile</PageTitle>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-heading), sans-serif", fontSize: 20, flexShrink: 0 }}>
            {initials || "?"}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)" }}>{client.firstName} {client.lastName}</div>
            {client.email && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}><Mail size={12} /> {client.email}</div>}
            {client.phone && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 5 }}><Phone size={12} /> {client.phone}</div>}
          </div>
        </div>
      </Card>

      <Link href="/app/membership">
        <Card style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{m ? m.name : "No active membership"}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{m ? m.status : "Tap to view"}</div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
        </Card>
      </Link>

      <div>
        <SectionTitle>Attendance history</SectionTitle>
        {history.length === 0 ? (
          <Card><div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "12px 0" }}>No past classes yet.</div></Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((b) => {
              const s = STATUS[b.status] ?? STATUS.booked;
              return (
                <Card key={b.bookingId} style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{b.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{dayLabel(b.date)} · {b.startTime}</div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: s.color }}>{s.label}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 6 }}>
        <LogoutButton />
      </div>
    </div>
  );
}
