import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getInboxAiSettings } from "@/lib/inbox/settings";
import { isBriefComplete } from "@/lib/businessProfile";
import { listTags } from "@/lib/inbox/tags";
import { InboxAiSettingsForm } from "@/components/settings/InboxAiSettingsForm";

export const dynamic = "force-dynamic";

export default async function InboxAiSettingsPage() {
  await requireAdminPage();
  const settings = getInboxAiSettings();
  const tags = listTags();
  const briefComplete = isBriefComplete();

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Settings"
        title="Inbox AI"
        subtitle="Control AI auto-replies and the tag vocabulary used to triage your messages."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <InboxAiSettingsForm
        initial={settings}
        tags={tags}
        briefComplete={briefComplete}
      />
    </div>
  );
}
