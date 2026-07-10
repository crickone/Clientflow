import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireAdminPage } from "@/lib/auth";
import { getVenueType } from "@/lib/settings";
import { VenueTypeForm } from "@/components/settings/VenueTypeForm";

export const dynamic = "force-dynamic";

export default async function VenueTypeSettingsPage() {
  await requireAdminPage();
  const current = getVenueType();

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
    </div>
  );
}
