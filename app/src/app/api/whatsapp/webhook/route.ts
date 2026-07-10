import { NextResponse, type NextRequest } from "next/server";

import { getWhatsAppBridge, isWhatsAppConfigured } from "@/lib/whatsapp";
import {
  addMessage,
  findLeadByPhone,
  findLeadMessageByProviderId,
  setLeadMessageStatus,
  setLeadStatus,
  upsertLead,
} from "@/lib/leads";
import {
  addClientMessage,
  findClientByPhone,
  findClientMessageByProviderId,
  setClientMessageStatus,
} from "@/lib/clientMessages";
import { logActivity } from "@/lib/queries";
import { runTriage } from "@/lib/inbox/triagePipeline";
import { onInboundFromClient, onInboundFromLead } from "@/lib/pipeline/stage";

export const dynamic = "force-dynamic";

/**
 * Inbound + delivery-status webhook from the WhatsApp bridge provider. Public
 * (in middleware) but secret-verified here. Always 200 on a verified call so the
 * provider doesn't retry on our no-ops; 401 only for an unverified caller.
 */
export async function POST(req: NextRequest) {
  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const bridge = getWhatsAppBridge();

  const url = new URL(req.url);
  const secret =
    url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret");
  if (!bridge.verifyWebhook(secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "non-json" });
  }

  // Inbound message → thread it against a client (preferred), a lead, or park
  // it as a new whatsapp lead so nothing is dropped.
  const inbound = bridge.parseInboundWebhook(body);
  if (inbound) {
    const client = findClientByPhone(inbound.fromPhone);
    if (client) {
      const inboundMsg = addClientMessage({
        clientId: client.id,
        direction: "inbound",
        channel: "whatsapp",
        content: inbound.text,
        providerMessageId: inbound.providerMessageId,
        sentAt: new Date(inbound.timestamp),
      });
      await logActivity(
        "whatsapp.inbound",
        `WhatsApp reply from ${client.firstName} ${client.lastName}`.trim(),
        { clientId: client.id },
      );
      try {
        onInboundFromClient(client.id);
      } catch (err) {
        console.error("[pipeline] client inbound hook failed:", err);
      }
      // Triage in the background — never block the webhook ack.
      void runTriage({
        ownerType: "client",
        ownerId: client.id,
        messageId: inboundMsg.id,
        messageText: inbound.text,
        channel: "whatsapp",
      }).catch((err) =>
        console.error("[triage] client inbound failed:", err),
      );
    } else {
      let lead = findLeadByPhone(inbound.fromPhone);
      if (!lead) {
        lead = upsertLead({
          source: "whatsapp",
          phone: inbound.fromPhone,
          notes: "Inbound WhatsApp from an unknown number.",
        }).lead;
      }
      const inboundMsg = addMessage({
        leadId: lead.id,
        direction: "inbound",
        channel: "whatsapp",
        content: inbound.text,
        providerMessageId: inbound.providerMessageId,
        sentAt: new Date(inbound.timestamp),
      });
      setLeadStatus(lead.id, "replied");
      try {
        onInboundFromLead(lead.id);
      } catch (err) {
        console.error("[pipeline] lead inbound hook failed:", err);
      }
      await logActivity(
        "whatsapp.inbound",
        `WhatsApp reply from ${inbound.fromPhone}`,
        { leadId: lead.id },
      );
      void runTriage({
        ownerType: "lead",
        ownerId: lead.id,
        messageId: inboundMsg.id,
        messageText: inbound.text,
        channel: "whatsapp",
      }).catch((err) => console.error("[triage] lead inbound failed:", err));
    }
  }

  // Delivery/read status → update the matching outbound row.
  const status = bridge.parseStatusWebhook(body);
  if (status) {
    const clientMsg = findClientMessageByProviderId(status.providerMessageId);
    if (clientMsg) {
      setClientMessageStatus(clientMsg.id, status.status);
    } else {
      const leadMsg = findLeadMessageByProviderId(status.providerMessageId);
      if (leadMsg) setLeadMessageStatus(leadMsg.id, status.status);
    }
  }

  return NextResponse.json({ ok: true });
}
