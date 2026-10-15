import Link from "next/link";
import { ChevronRight, Mail, Phone } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { clientHistory, clientMembership } from "@/lib/clientApp";
import { Badge } from "@/components/ui/Badge";
import { Card, dayLabel, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { LogoutButton } from "@/components/clientapp/LogoutButton";
import { MessagePrefs } from "@/components/clientapp/MessagePrefs";
import { PushSetup } from "@/components/clientapp/PushSetup";
import { getPrefs, vapidPublicKey } from "@/lib/push";
import { DevicesList } from "@/components/clientapp/DevicesList";
import { connectionsFor } from "@/lib/wearables/store";
import { isProviderId, PROVIDER_NAME, PROVIDERS } from "@/lib/wearables/model";
import { isProviderConfigured } from "@/lib/wearables/providers";
import { businessContact } from "@/lib/agreements";
import { consentsFor } from "@/lib/marketingConsent";
import { CONSENT_CHANNELS, CONSENT_LABEL, consentStatement } from "@/lib/memberChoicesModel";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "neutral" | "amber" | "green" | "red" }> = {
  attended: { label: "Attended", tone: "green" },
  no_show: { label: "Missed", tone: "red" },
  booked: { label: "Booked", tone: "neutral" },
};

export default async function ClientProfilePage({ searchParams }: { searchParams: { device?: string; status?: string } }) {
  const { clientId, client, tenantId } = requireClientPage();
  const m = clientMembership(clientId);
  const history = clientHistory(clientId, 12);
  const initials = `${client.firstName?.[0] ?? ""}${client.lastName?.[0] ?? ""}`.toUpperCase();
  const business = businessContact().name;
  const consents = consentsFor(clientId, client.email);
  const vapid = vapidPublicKey();
  const conns = connectionsFor(tenantId, clientId);
  const ago = (ms: number | null) => {
    if (!ms) return null;
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 2 ? "just now" : m < 60 ? `${m} minutes ago` : m < 1440 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
  };
  // Only devices the gym has set up; until then the section doesn't show at all.
  const deviceRows = PROVIDERS.filter((p) => isProviderConfigured(p.id) || conns.some((c) => c.provider === p.id)).map((p) => {
    const c = conns.find((x) => x.provider === p.id);
    return { id: p.id, name: p.name, gives: p.gives, available: isProviderConfigured(p.id), connected: Boolean(c), syncedAgo: ago(c?.lastSyncAt ?? null), error: c?.lastError ?? null };
  });
  const flash = isProviderId(searchParams.device) && searchParams.status ? { name: PROVIDER_NAME[searchParams.device], status: searchParams.status } : null;

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

      {vapid && (
        <div>
          <SectionTitle>Notifications</SectionTitle>
          <Card style={{ padding: "4px 16px" }}>
            <PushSetup vapidKey={vapid} prefs={getPrefs(clientId)} />
          </Card>
        </div>
      )}

      {deviceRows.length > 0 && (
        <div id="devices">
          <SectionTitle>Devices</SectionTitle>
          <Card style={{ padding: "4px 14px" }}>
            <DevicesList rows={deviceRows} flash={flash} />
          </Card>
        </div>
      )}

      <div>
        <SectionTitle>Messages from {business}</SectionTitle>
        <Card style={{ padding: "4px 16px" }}>
          <MessagePrefs
            items={CONSENT_CHANNELS.map((ch) => ({ channel: ch, label: CONSENT_LABEL[ch], statement: consentStatement(ch, business), on: consents[ch]?.granted === true }))}
          />
        </Card>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "6px 2px 0", lineHeight: 1.5 }}>
          Messages about your bookings and membership still come either way.
        </div>
      </div>

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
                    <Badge tone={s.tone}>{s.label}</Badge>
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
