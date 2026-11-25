import "server-only";

import { sendEmailForTenant, type SendOpts, type SendResult } from "@/lib/email";
import { isWhatsAppConfigured } from "@/lib/whatsapp/config";

/**
 * How the lead flows reach people: the business's own WhatsApp (Whapi) and
 * email. One seam, so a test can swap in a fake and nothing real is ever
 * sent from a test run.
 */
export interface FlowTransport {
  /** WhatsApp connected for the ambient tenant. */
  whatsAppConnected(): boolean;
  /** A WhatsApp to a lead, recorded on their conversation. Throws on a provider failure. */
  sendWhatsAppToLead(leadId: number, text: string): Promise<{ providerMessageId: string }>;
  /** A WhatsApp to any number (staff alerts), from the business WhatsApp. Throws on failure. */
  sendWhatsAppToNumber(phone: string, text: string): Promise<{ providerMessageId: string }>;
  /** Never throws. */
  sendEmail(tenantId: number, opts: SendOpts): Promise<SendResult>;
}

const real: FlowTransport = {
  whatsAppConnected: () => isWhatsAppConfigured(),
  async sendWhatsAppToLead(leadId, text) {
    // Loaded here: whatsapp/send imports leads, which imports the flows.
    const { sendWhatsApp } = await import("@/lib/whatsapp/send");
    const r = await sendWhatsApp({ subjectType: "lead", subjectId: leadId, text });
    return { providerMessageId: r.providerMessageId };
  },
  async sendWhatsAppToNumber(phone, text) {
    const { getWhatsAppBridge } = await import("@/lib/whatsapp");
    return getWhatsAppBridge().sendText(phone, text);
  },
  sendEmail: (tenantId, opts) => sendEmailForTenant(tenantId, opts),
};

let override: FlowTransport | undefined;

export function getFlowTransport(): FlowTransport {
  return override ?? real;
}

/** Tests only. */
export function setFlowTransportForTests(t: FlowTransport | undefined): void {
  override = t;
}
