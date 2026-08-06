import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireAdminPage } from "@/lib/auth";
import { CardLabel } from "@/components/ui/Card";
import { getSchedulingMode, getVenueType } from "@/lib/settings";
import { VenueTypeForm } from "@/components/settings/VenueTypeForm";
import { SchedulingModeForm } from "@/components/settings/SchedulingModeForm";

export const dynamic = "force-dynamic";

export default async function VenueTypeSettingsPage() {
  await requireAdminPage();
  const current = getVenueType();
  const scheduling = getSchedulingMode();

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Settings"
        title="Venue type"
        subtitle="Choose the vocabulary used across the app. The underlying data is identical — only the labels change."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <Card style={{ padding: 28 }}>
        <VenueTypeForm current={current} />
      </Card>

      <Card style={{ padding: 28, marginTop: 16 }}>
        <CardLabel>Scheduling</CardLabel>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.55, margin: "8px 0 18px" }}>
          Choose how this business schedules. Only the one you pick shows in the sidebar.
        </p>
        <SchedulingModeForm current={scheduling} />
      </Card>
    </div>
  );
}
