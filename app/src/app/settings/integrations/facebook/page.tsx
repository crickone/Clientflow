import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { facebookConfigured, getRedirectUri } from "@/lib/facebook/oauth";
import { listFacebookPages } from "@/lib/facebook/pages";
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
        subtitle="Connect a Facebook Page to pull in its Lead Ads leads the instant they're submitted — native, no Zapier/Make in the middle."
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
        redirectUri={getRedirectUri()}
        webhookUrl={`${getAppBaseUrl()}/api/integrations/facebook/leadgen`}
      />
    </div>
  );
}
