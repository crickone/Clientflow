"use client";

import { useState, useTransition } from "react";
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
