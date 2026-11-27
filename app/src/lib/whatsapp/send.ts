import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { getLead, addMessage } from "@/lib/leads";
import { addClientMessage } from "@/lib/clientMessages";
import { getWhatsAppBridge } from "@/lib/whatsapp";
import { logActivity } from "@/lib/queries";
import { attachmentLabel, checkOutgoingSet, type OutgoingFile } from "@/lib/attachments/outgoingModel";
import { mediaPlaceholder, type MessageMedia } from "@/lib/inbox/mediaModel";

export interface SendWhatsAppInput {
  subjectType: "lead" | "client";
  subjectId: number;
  /** The words. May be empty when files are attached. */
  text?: string;
  aiGenerated?: boolean;
  /** Files to send after the text, one WhatsApp message each. */
  attachments?: OutgoingFile[];
}

export interface SendWhatsAppResult {
  /** The first row stored (the text's, else the first file that went). */
  messageId: number;
  providerMessageId: string;
  /** One line per file that did not go: "<file name>: <reason>". Empty when everything went. */
  failed: string[];
  /** The stored file name (MessageMedia.file) of each file that did not go, in the same order as `failed`. */
  failedFiles: string[];
}

/**
 * Send a WhatsApp text (and any attached files) to a lead or client via the
 * bridge, then record each message on the subject's conversation thread.
 *
 * Text goes first, then each file as its own message with its own row
 * (`media` set, content the "[Photo]"-style placeholder the thread hides).
 * A file the provider refuses is stored as a failed row with its reason and
 * the rest still go. Throws (preserving the caller's draft) if the bridge
 * isn't connected, there's no phone on file, the text is refused, or nothing
 * at all was sent; nothing is stored then.
 */
export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  const text = (input.text ?? "").trim();
  const files = input.attachments ?? [];
  if (!text && files.length === 0) throw new Error("Message is empty.");
  if (files.length) {
    const set = checkOutgoingSet(files.map((f) => ({ size: f.bytes.length })), "whatsapp");
    if (!set.ok) throw new Error(set.error);
  }

  let phone: string | null = null;
  let name = "";
  if (input.subjectType === "lead") {
    const lead = getLead(input.subjectId);
    if (!lead) throw new Error("Lead not found.");
    phone = lead.phone;
    name =
      [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
      lead.phone ||
      "lead";
  } else {
    const client = db
      .select()
      .from(clients)
      .where(eq(clients.id, input.subjectId))
      .get();
    if (!client) throw new Error("Client not found.");
    phone = client.phone;
    name = `${client.firstName} ${client.lastName}`.trim();
  }
  if (!phone) throw new Error("No phone number on file for this contact.");

  const bridge = getWhatsAppBridge();
  if (files.length && !bridge.sendMedia) throw new Error("This WhatsApp connection can't send files.");

  const store = (row: { content: string; providerMessageId: string | null; status: "sent" | "failed"; media?: MessageMedia[]; error?: string }) =>
    input.subjectType === "lead"
      ? addMessage({
          leadId: input.subjectId,
          direction: "outbound",
          channel: "whatsapp",
          content: row.content,
          aiGenerated: input.aiGenerated,
          providerMessageId: row.providerMessageId,
          status: row.status,
          sentAt: new Date(),
          media: row.media,
          error: row.error,
        })
      : addClientMessage({
          clientId: input.subjectId,
          direction: "outbound",
          channel: "whatsapp",
          content: row.content,
          aiGenerated: input.aiGenerated,
          providerMessageId: row.providerMessageId,
          status: row.status,
          sentAt: new Date(),
          media: row.media,
          error: row.error,
        });

  let first: { messageId: number; providerMessageId: string } | null = null;
  if (text) {
    const { providerMessageId } = await bridge.sendText(phone, text);
    const stored = store({ content: text, providerMessageId, status: "sent" });
    first = { messageId: stored.id, providerMessageId };
  }

  // A file that fails before anything has gone waits here, so a send where
  // nothing went stores nothing; once something goes they are written in order.
  const failed: string[] = [];
  const failedFiles: string[] = [];
  let waiting: Array<{ media: MessageMedia; error: string }> = [];
  for (const f of files) {
    try {
      const { providerMessageId } = await bridge.sendMedia!(phone, {
        kind: f.media.kind,
        mime: f.media.mime,
        name: f.media.name,
        bytes: f.bytes,
      });
      for (const w of waiting) store({ content: mediaPlaceholder(w.media.kind), providerMessageId: null, status: "failed", media: [w.media], error: w.error });
      waiting = [];
      const stored = store({ content: mediaPlaceholder(f.media.kind), providerMessageId, status: "sent", media: [f.media] });
      if (!first) first = { messageId: stored.id, providerMessageId };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push(`${attachmentLabel(f.media)}: ${reason}`);
      failedFiles.push(f.media.file);
      if (first) store({ content: mediaPlaceholder(f.media.kind), providerMessageId: null, status: "failed", media: [f.media], error: reason });
      else waiting.push({ media: f.media, error: reason });
    }
  }
  if (!first) throw new Error(failed.length === 1 ? failed[0] : `Nothing was sent. ${failed.join(" ")}`);

  await logActivity("whatsapp.sent", `WhatsApp sent to ${name}`, {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    providerMessageId: first.providerMessageId,
  });

  return { ...first, failed, failedFiles };
}
