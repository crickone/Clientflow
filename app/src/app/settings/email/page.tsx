import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getEmailSender, hasEmailApiKey, getEmailProvider } from "@/lib/email";
import { getGmailConnection, isDriveConnected } from "@/lib/gmail";
import { googleConfigured } from "@/lib/google/oauth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { EmailSettingsForm } from "@/components/settings/EmailSettingsForm";
import { GmailConnectCard } from "@/components/settings/GmailConnectCard";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const sender = getEmailSender();
  const apiKeyPresent = hasEmailApiKey();
  const business = getBusinessProfile();
  const gmail = getGmailConnection(tenantId);
  const driveConnected = isDriveConnected(tenantId);
  const provider = getEmailProvider();

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Settings"
        title="Email"
        subtitle="Send staff invites and email your clients — from your own Gmail or your own domain."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />

      <GmailConnectCard
        connectedEmail={gmail?.email ?? null}
        googleConfigured={googleConfigured()}
        active={provider === "gmail"}
        driveConnected={driveConnected}
        connectedParam={searchParams.connected ?? null}
        errorParam={searchParams.error ?? null}
      />

      <div style={{ height: 16 }} />

      <EmailSettingsForm
        initial={sender}
        apiKeyPresent={apiKeyPresent}
        businessName={business.businessName}
        gmailActive={provider === "gmail"}
      />
    </div>
  );
}
