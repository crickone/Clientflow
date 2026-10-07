import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { googleConfigured } from "@/lib/google/oauth";
import { getGoogleBusinessConnection } from "@/lib/google/business";
import { GoogleConnectCard } from "@/components/settings/GoogleConnectCard";

export const dynamic = "force-dynamic";

export default async function GoogleSettingsPage({ searchParams }: { searchParams?: { error?: string; connected?: string } }) {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Integrations"
        title="Google"
        subtitle="Your Business Profile, Search Console and Analytics: post to Google, answer reviews and see how people find you."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <GoogleConnectCard
        configured={googleConfigured()}
        connection={getGoogleBusinessConnection(tenantId)}
        error={searchParams?.error ?? null}
        justConnected={searchParams?.connected === "1"}
      />
    </div>
  );
}
