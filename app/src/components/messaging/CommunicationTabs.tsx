"use client";

import { useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import type { CombinedItem } from "@/lib/combined";
import type { ConversationSummary } from "@/lib/conversations";
import { CombinedFeed } from "./CombinedFeed";
import { InboxClient } from "./InboxClient";

/**
 * The Communication tabs, controlled here so a conversation clicked in the
 * Combined feed opens straight into its chat on the Messages tab. This used to
 * be a link to /communication?c=..., the page already open: the URL changed
 * and nothing on screen did. ?c= still works for links from elsewhere (a
 * lead's "Open chat") as the initial selection.
 */
export function CommunicationTabs({
  combined,
  conversations,
  memberLabel,
  emptyMessages,
  emailPanel,
  emailCount,
  initialKey,
}: {
  combined: CombinedItem[];
  conversations: ConversationSummary[];
  memberLabel: string;
  emptyMessages: ReactNode;
  emailPanel: ReactNode;
  emailCount: number;
  initialKey: string | null;
}) {
  const [tab, setTab] = useState(initialKey ? "messages" : "combined");
  const [openKey, setOpenKey] = useState<string | null>(initialKey);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="combined">Combined</TabsTrigger>
        <TabsTrigger value="messages">Messages ({conversations.length})</TabsTrigger>
        <TabsTrigger value="email">Email ({emailCount})</TabsTrigger>
      </TabsList>

      <TabsContent value="combined">
        <div style={{ maxWidth: 640 }}>
          <CombinedFeed
            items={combined}
            onOpen={(key) => {
              setOpenKey(key);
              setTab("messages");
            }}
          />
        </div>
      </TabsContent>

      <TabsContent value="messages">
        {conversations.length === 0 ? (
          emptyMessages
        ) : (
          // Remounted per opened conversation so it starts on that chat.
          <InboxClient key={openKey ?? "newest"} conversations={conversations} memberLabel={memberLabel} initialKey={openKey} />
        )}
      </TabsContent>

      <TabsContent value="email">{emailPanel}</TabsContent>
    </Tabs>
  );
}
