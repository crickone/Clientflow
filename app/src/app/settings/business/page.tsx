import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { BusinessProfileForm } from "@/components/settings/BusinessProfileForm";

export const dynamic = "force-dynamic";

export default async function BusinessProfileSettingsPage() {
  await requireAdminPage();
  const profile = getBusinessProfile();

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Settings"
        title="Business profile"
        subtitle="Your business identity and brief. Used to generate content and shown across the app."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <BusinessProfileForm initial={profile} />
    </div>
  );
}
