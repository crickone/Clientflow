import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { facebookConfigured, getRedirectUri } from "@/lib/facebook/oauth";
import { listFacebookPages } from "@/lib/facebook/pages";
import { getMetaConnectionForTenant } from "@/lib/social/publisher";
import { getAppBaseUrl } from "@/lib/appUrl";
import { FacebookConnectCard } from "@/components/settings/FacebookConnectCard";

export const dynamic = "force-dynamic";

export default async function FacebookSettingsPage() {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Integrations"
        title="Facebook"
        subtitle="Connect your Facebook Page so scheduled posts go out to it and its linked Instagram account, and Lead Ads leads land in Leads the moment they are submitted."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <FacebookConnectCard
        configured={facebookConfigured()}
        pages={listFacebookPages(tenantId)}
        postingPageId={getMetaConnectionForTenant(tenantId)?.pageId ?? null}
        redirectUri={getRedirectUri()}
        webhookUrl={`${getAppBaseUrl()}/api/integrations/facebook/leadgen`}
      />
    </div>
  );
}
