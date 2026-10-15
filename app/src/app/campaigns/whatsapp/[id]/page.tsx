import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { renderBroadcast } from "@/lib/whatsappBroadcastModel";
import { AUDIENCE_LABEL, audienceCounts, audienceFor, broadcastRecipients, getBroadcast } from "@/lib/whatsappBroadcasts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BroadcastComposer } from "@/components/campaigns/BroadcastComposer";
import { StopBroadcastButton } from "@/components/campaigns/StopBroadcastButton";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent", cancelled: "Stopped" };
const SEND_LABEL: Record<string, { label: string; tone: "neutral" | "amber" | "green" | "red" }> = {
  queued: { label: "Waiting", tone: "neutral" },
  sending: { label: "Sending", tone: "amber" },
  sent: { label: "Sent", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  skipped: { label: "Skipped", tone: "neutral" },
};

function when(ms: number | null) {
  return ms ? new Date(ms).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }) : "";
}

export default async function BroadcastPage({ params }: { params: { id: string } }) {
  await requireAdminPage();
  const b = getBroadcast(Number(params.id));
  if (!b) notFound();
  const business = getBusinessProfile().businessName;

  const back = (
    <Link href="/campaigns/whatsapp" className="cp-back">
      <ArrowLeft size={14} /> WhatsApp broadcasts
    </Link>
  );

  if (b.status === "draft") {
    const sample = audienceFor(b.audience)[0]?.firstName ?? "Aoife";
    return (
      <div className="app-page">
        {back}
        <PageHeader eyebrow="WhatsApp broadcast" title={b.name} subtitle="Write it, pick who gets it, and send now or later." />
        <BroadcastComposer
          id={b.id}
          initial={{ name: b.name, message: b.message, audience: b.audience }}
          counts={audienceCounts()}
          businessName={business}
          sampleName={sample}
          connected={isWhatsAppConfigured()}
        />
      </div>
    );
  }

  const people = broadcastRecipients(b.id);
  const done = b.sent + b.failed + b.skipped;
  const pct = b.total ? Math.round((done / b.total) * 100) : 0;
  return (
    <div className="app-page">
      {back}
      <PageHeader
        eyebrow="WhatsApp broadcast"
        title={b.name}
        subtitle={`${STATUS_LABEL[b.status]}. ${AUDIENCE_LABEL[b.audience]}. ${b.status === "scheduled" ? `Starts ${when(b.sendAt)}.` : `Started ${when(b.startedAt ?? b.sendAt)}.`}`}
        actions={b.status === "sending" || b.status === "scheduled" ? <StopBroadcastButton id={b.id} /> : undefined}
      />
      <div className="wb-strip">
        <div>
          <span>Sent</span>
          <b>
            {b.sent} of {b.total}
          </b>
        </div>
        <div>
          <span>Waiting</span>
          <b>{b.queued}</b>
        </div>
        <div>
          <span>Failed</span>
          <b>{b.failed}</b>
        </div>
        <div>
          <span>Skipped (said no since, or no phone)</span>
          <b>{b.skipped}</b>
        </div>
      </div>
      {(b.status === "sending" || b.status === "scheduled") && (
        <div className="ml-bar" aria-label={`${pct}% done`} style={{ marginBottom: 18 }}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="wb-grid">
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table className="ib-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/clients/${p.clientId}`} style={{ color: "var(--text-primary)" }}>
                      {p.firstName} {p.lastName}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={SEND_LABEL[p.status].tone}>{SEND_LABEL[p.status].label}</Badge>
                    {p.error && <span className="wb-row-err">{p.error}</span>}
                  </td>
                  <td>{when(p.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="wb-preview">
          <div className="wb-preview-label">The message</div>
          <div className="wb-phone">
            <div className="wb-bubble">{renderBroadcast(b.message, { firstName: people[0]?.firstName ?? "Aoife" }, business)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
