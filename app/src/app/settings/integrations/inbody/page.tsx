import { headers } from "next/headers";

import { PageHeader } from "@/components/layout/PageHeader";
import { InBodySettings } from "@/components/settings/InBodySettings";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { ensureInBodyConnection, REGIONS } from "@/lib/inbody/connection";
import { listRecentScans, listUnmatchedScans, scanCounts } from "@/lib/inbody/scans";

export const dynamic = "force-dynamic";

export default async function InBodySettingsPage() {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const conn = ensureInBodyConnection(tenantId);

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const webhookUrl = `${proto}://${host}/api/inbody/webhook/${conn.webhookSecret}`;

  const people = db
    .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName, phone: clients.phone })
    .from(clients)
    .all()
    .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Integrations"
        title="InBody"
        subtitle="Body-composition scans from your InBody scanner, saved to each client's record and shown in their app."
      />
      <InBodySettings
        connection={{
          account: conn.account,
          hasApiKey: conn.hasApiKey,
          region: conn.region,
          lastTestAt: conn.lastTestAt,
          lastTestOk: conn.lastTestOk,
          lastError: conn.lastError,
          lastWebhookAt: conn.lastWebhookAt,
        }}
        regions={REGIONS.map((r) => ({ value: r.value, label: r.label }))}
        webhookUrl={webhookUrl}
        serverIp={process.env.OUTBOUND_IP?.trim() || null}
        counts={scanCounts()}
        unmatched={listUnmatchedScans()}
        recent={listRecentScans(15)}
        people={people}
      />
    </div>
  );
}
