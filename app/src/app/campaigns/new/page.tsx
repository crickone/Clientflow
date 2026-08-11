import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { getEmailSender } from "@/lib/email";
import { listContactTags } from "@/lib/marketing/campaigns";
import { getSendingDomain } from "@/lib/marketing/domains";
import { PageHeader } from "@/components/layout/PageHeader";
import { CampaignEditor } from "@/components/campaigns/CampaignEditor";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;

  // Prefill from/name from the tenant's configured sender identity (Settings
  // -> Email) when one exists — the same identity one-to-one client emails
  // and automations already send from. Both editable; neither required to
  // come from here.
  const sender = getEmailSender();
  const domain = getSendingDomain(tenantId);
  const tags = listContactTags();

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow="Email marketing"
        title="New campaign"
        subtitle="Compose an email to send to your mailing list. Saved as a draft until you're ready."
      />
      <CampaignEditor
        campaign={null}
        availableTags={tags}
        defaultFromName={sender.fromName}
        defaultFromEmail={sender.fromEmail}
        sendingDomain={domain?.domain ?? null}
      />
    </div>
  );
}
