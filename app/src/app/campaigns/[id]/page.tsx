import { notFound } from "next/navigation";

import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { getCampaign, listContactTags, resolveAudience } from "@/lib/marketing/campaigns";
import { getSendingDomain } from "@/lib/marketing/domains";
import { getCampaignSendCounts } from "@/lib/marketing/events";
import { PageHeader } from "@/components/layout/PageHeader";
import { CampaignEditor } from "@/components/campaigns/CampaignEditor";
import { Card, CardLabel, CardValue } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

// Delivery-stats tiles, in funnel order. Keyed to campaign_sends.status
// (schema.ts) — 'queued' is omitted deliberately: the send pipeline (Task 5)
// never actually inserts a row with that status (every insert is 'sent' or
// 'failed' at send time), so it would only ever read 0.
const STAT_ITEMS: { key: string; label: string }[] = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "opened", label: "Opened" },
  { key: "clicked", label: "Clicked" },
  { key: "bounced", label: "Bounced" },
  { key: "complained", label: "Complained" },
  { key: "unsubscribed", label: "Unsubscribed" },
  { key: "failed", label: "Failed" },
];

export default async function CampaignDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdminPage();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();

  const campaign = getCampaign(id);
  if (!campaign) notFound();

  const tenantId = getCurrentMembership()!.tenant.id;
  const domain = getSendingDomain(tenantId);
  const tags = listContactTags();
  // As-of-last-save recipient count (not a live/unsaved preview) — cheap to
  // compute here since resolveAudience just needs the campaign's own
  // (already parsed) audience field.
  const recipientCount = resolveAudience(campaign).emails.length;

  // Live delivery stats (Task 7) — queried fresh from campaign_sends every
  // render rather than trusting the campaign's persisted `stats` JSON, so
  // this never shows numbers staler than the DB itself. Only meaningful once
  // a campaign has left 'draft' (nothing has been sent yet before that).
  const showStats = campaign.status !== "draft";
  const counts = showStats ? getCampaignSendCounts(tenantId, id) : null;

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow="Email marketing"
        title={campaign.name}
        subtitle={`Status: ${campaign.status}`}
      />
      <CampaignEditor
        campaign={campaign}
        availableTags={tags}
        recipientCount={recipientCount}
        sendingDomain={domain?.domain ?? null}
      />
      {counts && (
        <Card style={{ padding: 20, marginTop: 24 }}>
          <CardLabel>Delivery stats</CardLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 20,
              marginTop: 4,
            }}
          >
            {STAT_ITEMS.map(({ key, label }) => (
              <div key={key}>
                <CardValue style={{ fontSize: 28 }}>{(counts[key] ?? 0).toLocaleString()}</CardValue>
                <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
