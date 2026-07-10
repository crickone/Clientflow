import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { WhatsAppConnectForm } from "@/components/settings/WhatsAppConnectForm";

export const dynamic = "force-dynamic";

export default async function WhatsAppSettingsPage() {
  await requireAdminPage();
  const cfg = getWhatsAppConfig();

  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const secretParam = cfg.webhookSecret ? `?secret=${cfg.webhookSecret}` : "";
  const webhookUrl = `${proto}://${host}/api/whatsapp/webhook${secretParam}`;

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Integrations"
        title="WhatsApp"
        subtitle="Connect a WhatsApp number to message leads and clients from their conversation thread."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <WhatsAppConnectForm
        initial={{ token: cfg.token, channel: cfg.channel, baseUrl: cfg.baseUrl }}
        webhookUrl={webhookUrl}
      />
    </div>
  );
}
