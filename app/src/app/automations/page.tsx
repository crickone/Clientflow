import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listTriggers } from "@/lib/automations";
import { TriggerListView } from "@/components/automations/TriggerListView";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await requireUser();
  const triggers = listTriggers();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Automation"
        title="Trigger List"
        subtitle="Choose a trigger below and create a series of messages to be sent when that action takes place."
      />
      <TriggerListView triggers={triggers} />
    </div>
  );
}
