import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { getCurrentTenant } from "@/lib/db/tenant";
import { WhatsAppConnectForm } from "@/components/settings/WhatsAppConnectForm";

export const dynamic = "force-dynamic";

export default async function WhatsAppSettingsPage() {
  await requireAdminPage();
  const cfg = getWhatsAppConfig();

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // The business goes in the address so each gym's replies land in its own account.
  const q = new URLSearchParams({ t: getCurrentTenant().slug });
  if (cfg.webhookSecret) q.set("secret", cfg.webhookSecret);
  const webhookUrl = `${proto}://${host}/api/whatsapp/webhook?${q.toString()}`;

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Integrations"
        title="WhatsApp"
        subtitle="Connect a WhatsApp number to message leads and clients from their conversation thread."
      />
      <WhatsAppConnectForm
        initial={{ token: cfg.token, channel: cfg.channel, baseUrl: cfg.baseUrl }}
        webhookUrl={webhookUrl}
      />
    </div>
  );
}
