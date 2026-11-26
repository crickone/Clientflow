"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { sendClientWhatsAppAction } from "@/app/clients/actions";
import { ConversationThread, type ThreadMessage } from "./ConversationThread";

export function ClientConversation({
  clientId,
  hasPhone,
  initialMessages,
}: {
  clientId: number;
  hasPhone: boolean;
  initialMessages: ThreadMessage[];
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [pending, start] = useTransition();
  const router = useRouter();

  // Fresh messages from the server (after the history below fills in) replace what is shown.
  useEffect(() => setMessages(initialMessages), [initialMessages]);

  // The whole WhatsApp chat, including what was sent from the phone or another tool (lib/whatsapp/history).
  useEffect(() => {
    if (!hasPhone) return;
    let gone = false;
    fetch(`/api/clients/${clientId}/whatsapp-history`, { method: "POST" })
      .then((r) => r.json())
      .then((d: { added?: number }) => {
        if (!gone && (d.added ?? 0) > 0) router.refresh();
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [clientId, hasPhone, router]);

  function handleSend(text: string) {
    start(async () => {
      const res = await sendClientWhatsAppAction(clientId, text);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: res.messageId,
          direction: "outbound",
          channel: "whatsapp",
          content: text,
          status: "sent",
          sentAt: new Date(),
          createdAt: new Date(),
        },
      ]);
      toast.success("Sent via WhatsApp.");
    });
  }

  return (
    <ConversationThread
      messages={messages}
      canSend={hasPhone}
      sending={pending}
      onSend={handleSend}
      emptyHint="No messages yet. Send a WhatsApp to start the conversation."
    />
  );
}
