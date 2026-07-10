import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getTheme } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getBrandingLogoFilename } from "@/lib/settings";
import { resolveLogoPath } from "@/lib/branding";
import { AppearanceView } from "@/components/settings/AppearanceView";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  await requireAdminPage();
  const theme = getTheme();
  const hasLogo = getBrandingLogoFilename() !== null && resolveLogoPath() !== null;
  const businessName = getBusinessProfile().businessName;

  return (
    <div className="app-page" style={{ maxWidth: 760 }}>
      <PageHeader
        eyebrow="Settings"
        title="Appearance"
        subtitle="Theme the whole app to your brand — set the background and accent colour, and upload the logo shown at the top."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <AppearanceView theme={theme} hasLogo={hasLogo} businessName={businessName} />
    </div>
  );
}
