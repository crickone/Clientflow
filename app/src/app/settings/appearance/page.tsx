import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getTheme } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { AppearanceView } from "@/components/settings/AppearanceView";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  await requireAdminPage();
  const theme = getTheme();
  const businessName = getBusinessProfile().businessName;

  return (
    <div className="app-page" style={{ maxWidth: 760 }}>
      <PageHeader
        eyebrow="Settings"
        title="Appearance"
        subtitle="Theme the whole app to your brand — set the background and accent colour, and pick the heading font."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <AppearanceView theme={theme} businessName={businessName} />
    </div>
  );
}
