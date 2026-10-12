import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getBrandImageStyle } from "@/lib/settings";
import { BusinessProfileForm } from "@/components/settings/BusinessProfileForm";

export const dynamic = "force-dynamic";

export default async function BusinessProfileSettingsPage() {
  await requireAdminPage();
  const profile = getBusinessProfile();

  return (
    <div className="app-page" style={{ maxWidth: 1080 }}>
      <PageHeader
        eyebrow="Settings"
        title="Business profile"
        subtitle="Who you are and how you sound. Adonis reads all of this before it writes anything for you."
      />
      <BusinessProfileForm initial={profile} imageStyle={getBrandImageStyle() ?? ""} />
    </div>
  );
}
