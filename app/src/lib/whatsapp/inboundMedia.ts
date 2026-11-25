import "server-only";

import { ingestMessageMediaLater, type IncomingAttachment, type MediaOwner } from "@/lib/inbox/media";
import type { InboundMessage, WhatsAppBridge } from "./types";

/** The download plan for an inbound WhatsApp message's attachments (empty for plain text). */
export function whatsAppAttachments(bridge: WhatsAppBridge, inbound: InboundMessage): IncomingAttachment[] {
  return (inbound.media ?? []).map((m) => ({
    kind: m.kind,
    sources: bridge.mediaSources?.(m) ?? (m.link ? [{ url: m.link }] : []),
    mime: m.mime,
    name: m.name,
    size: m.size,
  }));
}

/**
 * Fetch an inbound WhatsApp photo / voice note / document onto its stored
 * message, after the webhook has answered. A no-op for a text message.
 */
export function ingestWhatsAppMediaLater(tenantId: number, owner: MediaOwner, messageId: number, bridge: WhatsAppBridge, inbound: InboundMessage): void {
  ingestMessageMediaLater({ tenantId, owner, messageId, attachments: whatsAppAttachments(bridge, inbound) });
}
