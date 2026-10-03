import Link from "next/link";
import { MessageCircle, Mail, AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { EmailInbox } from "@/components/messaging/EmailInbox";
import { CommunicationTabs } from "@/components/messaging/CommunicationTabs";
import { requireUserPage, getCurrentMembership } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { listRecentClientEmails } from "@/lib/clientEmail";
import { getGmailConnection, listEmailThreads } from "@/lib/gmail";
import { getImapConnection } from "@/lib/imapEmail";
import { listCombinedFeed } from "@/lib/combined";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

export default async function CommunicationPage({ searchParams }: { searchParams?: { c?: string } }) {
  await requireUserPage();
  const vocab = getVocab(getVenueType());
  const conversations = listConversations();
  const tenantId = getCurrentMembership()!.tenant.id;
  const gmail = getGmailConnection(tenantId);
  const imap = getImapConnection(tenantId);
  const emailConn = gmail ?? imap; // whichever is connected
  // With Gmail or IMAP connected we show the synced two-way inbox; otherwise the sent log.
  const threads = emailConn ? listEmailThreads() : [];
  const emails = emailConn ? [] : listRecentClientEmails();
  const emailCount = emailConn ? threads.length : emails.length;
  const combined = listCombinedFeed();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Inbox"
        title="Communication"
        subtitle="All your conversations in one place: WhatsApp, Messenger, Instagram and email."
      />

      <CommunicationTabs
        combined={combined}
        conversations={conversations}
        memberLabel={vocab.member}
        initialKey={searchParams?.c ?? null}
        emailCount={emailCount}
        emptyMessages={
          <EmptyState
            icon={<MessageCircle size={32} strokeWidth={1.4} />}
            title="No conversations yet"
            message="WhatsApp messages and Facebook and Instagram DMs you send or receive appear here, one conversation per person."
          />
        }
        emailPanel={<>
          {emailConn ? (
            <EmailInbox threads={threads} connectedEmail={emailConn.email} />
          ) : emails.length === 0 ? (
            <EmptyState
              icon={<Mail size={32} strokeWidth={1.4} />}
              title="No emails sent yet"
              message={`Emails you send to a ${vocab.member.toLowerCase()} from their profile appear here. Connect an email account in Settings → Email for a full two-way inbox.`}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {emails.map((m) => (
                <Link key={m.id} href={`/clients/${m.clientId}`} style={{ textDecoration: "none" }}>
                  <Card style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
                        {m.clientName}
                      </strong>
                      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                        {m.toEmail}
                      </span>
                      {m.status === "failed" && (
                        <Badge tone="red">
                          <AlertTriangle size={12} /> Failed
                        </Badge>
                      )}
                      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
                        {fmt(m.createdAt)}
                      </span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-secondary)" }}>
                      {m.subject}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
</>}
      />
    </div>
  );
}
