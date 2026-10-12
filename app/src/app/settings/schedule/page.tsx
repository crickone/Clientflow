import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScheduleForm } from "@/components/settings/ScheduleForm";
import { getSettings } from "@/lib/settings";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  await requireAdminPage();
  const settings = getSettings();
  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader
        eyebrow="Settings"
        title="Schedule"
        subtitle="Opening hours, calendar grid, and how the booking flow handles overlap."
      />
      <ScheduleForm settings={settings} />
    </div>
  );
}
