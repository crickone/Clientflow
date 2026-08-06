import "server-only";

import { getCurrentTenant } from "@/lib/db/tenant";
import { getGmailConnection, listEmailThreads } from "@/lib/gmail";
import { listConversations } from "@/lib/conversations";

export type CombinedItem = {
  id: string;
  kind: "email" | "whatsapp";
  title: string;
  subtitle: string;
  snippet: string;
  at: number;
  href: string | null;
  unread: boolean;
  direction: string;
};

/** Emails (if Gmail connected) + WhatsApp conversations, merged newest-first. */
export function listCombinedFeed(): CombinedItem[] {
  const items: CombinedItem[] = [];
  const gmail = getGmailConnection(getCurrentTenant().id);

  if (gmail) {
    for (const t of listEmailThreads(60)) {
      items.push({
        id: `email-${t.id}`,
        kind: "email",
        title: t.direction === "in" ? t.fromName || t.fromEmail || "Unknown" : `To: ${t.toEmail ?? ""}`,
        subtitle: t.subject || "(no subject)",
        snippet: t.snippet ?? "",
        at: t.internalDate ?? 0,
        href: t.clientId ? `/clients/${t.clientId}` : null,
        unread: t.direction === "in" && !t.isRead,
        direction: t.direction === "in" ? "received" : "sent",
      });
    }
  }

  for (const c of listConversations()) {
    items.push({
      id: `wa-${c.kind}-${c.contactId}`,
      kind: "whatsapp",
      title: c.name,
      subtitle: "WhatsApp",
      snippet: c.lastMessage,
      at: c.lastAt.getTime(),
      href: c.href,
      unread: c.needsAttention,
      direction: c.lastDirection,
    });
  }

  items.sort((a, b) => b.at - a.at);
  return items;
}
