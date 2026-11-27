import Link from "next/link";
import { Mail, Plus, Users, Globe } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { listCampaigns, resolveAudience } from "@/lib/marketing/campaigns";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  draft: "neutral",
  scheduled: "amber",
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
        eyebrow="Marketing"
        title="Email campaigns"
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
        <div className="dt-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Name</th>
                <th>Subject</th>
                <th>Status</th>
                <th className="dt-num">Recipients</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/campaigns/${c.id}`}>
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.subject}</td>
                  <td>
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                  </td>
                  <td className="dt-num">{counts[i].toLocaleString()}</td>
                  <td>{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
