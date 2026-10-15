import Link from "next/link";
import { MessageCircle, Plus, Settings2 } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { audienceCounts, listBroadcasts } from "@/lib/whatsappBroadcasts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { newBroadcastAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "neutral" | "amber" | "green" | "red" }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "amber" },
  sending: { label: "Sending", tone: "amber" },
  sent: { label: "Sent", tone: "green" },
  cancelled: { label: "Stopped", tone: "red" },
};

function when(ms: number | null) {
  return ms ? new Date(ms).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }) : "";
}

/** WhatsApp broadcasts: one message to every member who said yes to news and offers on WhatsApp. */
export default async function WhatsAppBroadcastsPage() {
  await requireAdminPage();
  const connected = isWhatsAppConfigured();
  const counts = audienceCounts();
  const rows = listBroadcasts();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Messaging"
        title="WhatsApp broadcasts"
        subtitle="One WhatsApp message to every member who said yes to news and offers on WhatsApp."
        actions={
          <form action={newBroadcastAction}>
            <Button size="sm" type="submit" disabled={!connected}>
              <Plus size={14} /> New broadcast
            </Button>
          </form>
        }
      />

      <div className="wb-strip">
        <div>
          <span>Members who said yes</span>
          <b>{counts.everyone}</b>
        </div>
        <div>
          <span>Of those, with an active membership</span>
          <b>{counts.active}</b>
        </div>
        <div>
          <span>WhatsApp</span>
          <b>{connected ? "Connected" : "Not connected"}</b>
        </div>
      </div>

      {!connected && (
        <Card className="wb-note">
          Connect your WhatsApp number first, under{" "}
          <Link href="/settings/integrations/whatsapp">
            <Settings2 size={13} /> Settings, Integrations, WhatsApp
          </Link>
          .
        </Card>
      )}
      {counts.everyone === 0 && (
        <p className="wb-hint">
          Members say yes in the app: in the welcome steps, or under Profile, Messages from you. Only they get broadcasts, and every message tells them to reply STOP to stop.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<MessageCircle size={32} strokeWidth={1.4} />} title="No broadcasts yet" message="Write one message, pick who gets it, and it goes out a few a minute between 9am and 9pm." />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table className="ib-table">
            <thead>
              <tr>
                <th>Broadcast</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Failed</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/campaigns/whatsapp/${b.id}`} style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                      {b.name}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
                  </td>
                  <td>{b.status === "draft" ? "" : `${b.sent} of ${b.total}`}</td>
                  <td>{b.failed || ""}</td>
                  <td>{b.status === "draft" ? when(b.createdAt) : when(b.sendAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
