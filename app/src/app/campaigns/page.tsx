import Link from "next/link";
import { Mail, Plus, Users, Globe } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { listCampaigns, resolveAudience } from "@/lib/marketing/campaigns";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  draft: "neutral",
  sending: "amber",
  sent: "green",
  paused: "amber",
  failed: "red",
};

export default async function CampaignsPage() {
  await requireAdminPage();

  const campaigns = listCampaigns();
  const counts = campaigns.map((c) => resolveAudience(c).emails.length);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Email marketing"
        title="Campaigns"
        subtitle="Compose and send one-off emails to your mailing list."
        actions={
          <>
            <Link href="/campaigns/contacts">
              <Button variant="ghost" size="sm">
                <Users size={14} /> Contacts
              </Button>
            </Link>
            <Link href="/campaigns/domains">
              <Button variant="ghost" size="sm">
                <Globe size={14} /> Sending domain
              </Button>
            </Link>
            <Link href="/campaigns/new">
              <Button size="sm">
                <Plus size={14} /> New campaign
              </Button>
            </Link>
          </>
        }
      />

      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Mail size={32} strokeWidth={1.4} />}
          title="No campaigns yet"
          message="Create a campaign to send your mailing list an update, offer, or announcement."
          action={
            <Link href="/campaigns/new">
              <Button>
                <Plus size={15} /> New campaign
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
                <th style={th}>Subject</th>
                <th style={th}>Status</th>
                <th style={th}>Recipients</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.id}>
                  <td style={{ ...td, color: "var(--text-primary)" }}>
                    <Link href={`/campaigns/${c.id}`} style={{ color: "inherit" }}>
                      {c.name}
                    </Link>
                  </td>
                  <td style={td}>{c.subject}</td>
                  <td style={td}>
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                  </td>
                  <td style={td}>{counts[i].toLocaleString()}</td>
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
