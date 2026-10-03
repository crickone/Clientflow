import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { facebookConfigured } from "@/lib/facebook/oauth";
import { listFacebookPages } from "@/lib/facebook/pages";
import { getMetaConnectionForTenant } from "@/lib/social/publisher";
import { listAdAccounts, getGrantInfo } from "@/lib/facebook/grants";
import { FacebookConnectCard } from "@/components/settings/FacebookConnectCard";

export const dynamic = "force-dynamic";

export default async function FacebookSettingsPage() {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Integrations"
        title="Facebook & Instagram"
        subtitle="Post, answer messages, collect leads and run ads, all from AdonisAgent."
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
        adAccounts={listAdAccounts(tenantId, { granted: true })}
        grant={getGrantInfo(tenantId)}
      />
    </div>
  );
}
