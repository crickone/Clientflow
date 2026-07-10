import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listSent } from "@/lib/automations";
import { SentMessagesView } from "@/components/automations/SentMessagesView";

export const dynamic = "force-dynamic";

export default async function SentMessagesPage() {
  await requireUser();
  const sent = listSent();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Automation"
        title="Sent Messages"
        subtitle="Messages that have been sent via automation."
      />
      <SentMessagesView sent={sent} />
    </div>
  );
}
