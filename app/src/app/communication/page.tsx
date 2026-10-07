import { UnifiedInbox } from "@/components/inbox/UnifiedInbox";
import { requireUserPage, getCurrentMembership } from "@/lib/auth";
import { getGmailConnection } from "@/lib/gmail";
import { getImapConnection } from "@/lib/imapEmail";
import { listInboxItems } from "@/lib/inbox/unified";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function CommunicationPage({ searchParams }: { searchParams?: { c?: string; open?: string } }) {
  await requireUserPage();
  const vocab = getVocab(getVenueType());
  const tenantId = getCurrentMembership()!.tenant.id;
  // With Gmail or IMAP connected the inbox is two-way; otherwise email is the
  // log of what was sent from client profiles.
  const emailConn = getGmailConnection(tenantId) ?? getImapConnection(tenantId);
  const items = listInboxItems(emailConn ? "two-way" : "sent-log");
  // ?c=<kind>-<id> is the older link to a conversation (a lead's "Open chat").
  const initialOpen = searchParams?.open ?? (searchParams?.c ? `conv:${searchParams.c}` : null);

  return (
    <div className="app-page inbox-page">
      <header className="inbox-page-head">
        <h1 className="dash-greeting">Communication</h1>
        <p className="inbox-page-sub">Email, WhatsApp, Messenger and Instagram in one place.</p>
      </header>
      <UnifiedInbox
        items={items}
        memberLabel={vocab.member}
        connectedEmail={emailConn?.email ?? null}
        emailMode={emailConn ? "two-way" : "sent-log"}
        initialOpen={initialOpen}
      />
    </div>
  );
}
