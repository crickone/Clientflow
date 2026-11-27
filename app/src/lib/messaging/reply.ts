import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientMessages, leadMessages } from "@/lib/db/schema";
import { sendWhatsApp } from "@/lib/whatsapp/send";
import { sendDm } from "@/lib/social/dm";
import type { OutgoingFile } from "@/lib/attachments/outgoingModel";

/**
 * Reply to a lead or client on the channel they last wrote on: Messenger or
 * Instagram when their latest inbound message came in there, WhatsApp
 * otherwise. The inbox composer and the triage auto-reply both send through
 * here, so a DM is never answered by WhatsApp (or the other way round).
 */
export type ReplyChannel = "whatsapp" | "messenger" | "instagram";

const REPLYABLE = ["whatsapp", "messenger", "instagram"] as const;

export function lastInboundChannel(subjectType: "lead" | "client", subjectId: number): ReplyChannel | null {
  const row =
    subjectType === "lead"
      ? db
          .select({ channel: leadMessages.channel })
          .from(leadMessages)
          .where(and(eq(leadMessages.leadId, subjectId), eq(leadMessages.direction, "inbound"), inArray(leadMessages.channel, [...REPLYABLE])))
          .orderBy(desc(leadMessages.id))
          .get()
      : db
          .select({ channel: clientMessages.channel })
          .from(clientMessages)
          .where(and(eq(clientMessages.clientId, subjectId), eq(clientMessages.direction, "inbound"), inArray(clientMessages.channel, [...REPLYABLE])))
          .orderBy(desc(clientMessages.id))
          .get();
  return (row?.channel as ReplyChannel | undefined) ?? null;
}

export async function sendReply(input: {
  subjectType: "lead" | "client";
  subjectId: number;
  /** May be empty when files are attached. */
  text?: string;
  aiGenerated?: boolean;
  /** Files to send after the text, on the same channel. */
  attachments?: OutgoingFile[];
}): Promise<{ messageId: number; channel: ReplyChannel; failed: string[]; failedFiles: string[] }> {
  const channel = lastInboundChannel(input.subjectType, input.subjectId);
  if (channel === "messenger" || channel === "instagram") {
    const sent = await sendDm(input);
    return { messageId: sent.messageId, channel: sent.channel, failed: sent.failed, failedFiles: sent.failedFiles };
  }
  const sent = await sendWhatsApp(input);
  return { messageId: sent.messageId, channel: "whatsapp", failed: sent.failed, failedFiles: sent.failedFiles };
}
