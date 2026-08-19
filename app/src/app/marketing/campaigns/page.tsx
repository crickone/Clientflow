import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { listAssets, listCampaigns } from "@/lib/campaigns/store";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

// Campaign Engine hub (Slice 1, Task 7) — the operator-facing list of
// campaign kits the Marketing agent builds conversationally (see
// /agents/marketing). Admin-gated to match that agent chat + the email
// Campaigns group (both requireAdminPage) — see Sidebar.tsx's comment on the
// Marketing nav item for why.
const STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  building: "neutral",
  ready: "amber",
  active: "green",
  complete: "green",
  archived: "neutral",
};

export default async function MarketingCampaignsPage() {
  await requireAdminPage();

  const campaigns = listCampaigns();
  // Cheap per-campaign approved/total tally — campaigns are few (a handful
  // per tenant, ~10 assets each), so N synchronous reads here is fine and
  // lets the list itself show build progress at a glance (the whole point
  // of a "hub"), rather than making every row a guess until you click in.
  const progress = campaigns.map((c) => {
    const assets = listAssets(c.id);
    return { approved: assets.filter((a) => a.status === "approved").length, total: assets.length };
  });

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Marketing"
        title="Campaigns"
        subtitle="Seasonal campaign kits — offer, blog, social posts, emails, ad copy and a video script, drafted by the Marketing agent and approved one asset at a time."
        actions={
          <Link href="/agents/marketing">
            <Button size="sm">
              <Plus size={14} /> New campaign
            </Button>
          </Link>
        }
      />

      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={32} strokeWidth={1.4} />}
          title="No campaigns yet"
          message="Ask Adonis to build a campaign — open the Marketing agent and describe a season, offer or promotion. It drafts the whole kit (offer, blog, social, email, ad copy, video script) for your approval, one asset at a time."
          action={
            <Link href="/agents/marketing">
              <Button>
                <Plus size={15} /> Ask Adonis
              </Button>
            </Link>
          }
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Season</th>
                <th style={th}>Status</th>
                <th style={th}>Assets</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.id}>
                  <td style={{ ...td, color: "var(--text-primary)" }}>
                    <Link href={`/marketing/campaigns/${c.id}`} style={{ color: "inherit" }}>
                      {c.name}
                    </Link>
                  </td>
                  <td style={td}>{c.season || "—"}</td>
                  <td style={td}>
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                  </td>
                  <td style={td}>
                    {progress[i].approved}/{progress[i].total} approved
                  </td>
                  <td style={td}>{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  borderBottom: "1px solid var(--hairline)",
};
const td: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 14,
  color: "var(--text-secondary)",
};
