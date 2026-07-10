import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { getLead, addMessage } from "@/lib/leads";
import { addClientMessage } from "@/lib/clientMessages";
import { getWhatsAppBridge } from "@/lib/whatsapp";
import { logActivity } from "@/lib/queries";

export interface SendWhatsAppInput {
  subjectType: "lead" | "client";
  subjectId: number;
  text: string;
  aiGenerated?: boolean;
}

/**
 * Send a WhatsApp text to a lead or client via the bridge, then record it on the
 * subject's conversation thread. Throws (preserving the caller's draft) if the
 * bridge isn't connected, there's no phone on file, or the provider rejects it.
 */
export async function sendWhatsApp(
  input: SendWhatsAppInput,
): Promise<{ messageId: number; providerMessageId: string }> {
  const text = input.text.trim();
  if (!text) throw new Error("Message is empty.");

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
  const { providerMessageId } = await bridge.sendText(phone, text);

  const stored =
    input.subjectType === "lead"
      ? addMessage({
          leadId: input.subjectId,
          direction: "outbound",
          channel: "whatsapp",
          content: text,
          aiGenerated: input.aiGenerated,
          providerMessageId,
          status: "sent",
          sentAt: new Date(),
        })
      : addClientMessage({
          clientId: input.subjectId,
          direction: "outbound",
          channel: "whatsapp",
          content: text,
          aiGenerated: input.aiGenerated,
          providerMessageId,
          status: "sent",
          sentAt: new Date(),
        });

  await logActivity("whatsapp.sent", `WhatsApp sent to ${name}`, {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    providerMessageId,
  });

  return { messageId: stored.id, providerMessageId };
}
