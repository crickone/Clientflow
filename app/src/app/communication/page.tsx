import { MessageCircle } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { InboxClient } from "@/components/messaging/InboxClient";
import { requireUserPage } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function CommunicationPage() {
  await requireUserPage();
  const vocab = getVocab(getVenueType());
  const conversations = listConversations();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Inbox"
        title="Communication"
        subtitle="All your conversations in one place. WhatsApp now; email next."
      />

      {/* Channel tabs — WhatsApp live, Email coming soon */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--grid)", marginBottom: 24 }}>
        <span
          style={{
            padding: "12px 16px",
            fontFamily: "var(--font-mono), monospace",
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--accent)",
            borderBottom: "1px solid var(--accent)",
            marginBottom: -1,
          }}
        >
          WhatsApp
        </span>
        <span
          title="Coming soon"
          style={{
            padding: "12px 16px",
            fontFamily: "var(--font-mono), monospace",
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          Email <Badge>Soon</Badge>
        </span>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageCircle size={32} strokeWidth={1.4} />}
          title="No conversations yet"
          message="Messages you send or receive over WhatsApp will appear here."
        />
      ) : (
        <InboxClient conversations={conversations} memberLabel={vocab.member} />
      )}
    </div>
  );
}
