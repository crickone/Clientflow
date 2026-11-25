import { NextResponse, type NextRequest } from "next/server";

import { runWithTenant } from "@/lib/db/tenant";
import { listTenants } from "@/lib/tenants";
import { getWhatsAppConfig, isWhatsAppConfiguredForTenant } from "@/lib/whatsapp/config";
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
import { AiCapError } from "@/lib/ai/usage";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { recordConsent } from "@/lib/marketingConsent";
import { isOptedIn } from "@/lib/whatsappBroadcasts";
import { isStopReply } from "@/lib/whatsappBroadcastModel";
import { notifyInboundMessage } from "@/lib/notifications/notify";
import { ingestWhatsAppMediaLater } from "@/lib/whatsapp/inboundMedia";
import { onWhatsAppDeliveryFailed } from "@/lib/leadFlows/undelivered";
import { withdrawConsentOnStopReply } from "@/lib/leadFlows/consent";

/**
 * Distinguishes an expected "tenant is over its monthly AI cap" skip from a
 * genuine triage failure in the logs — both are already non-fatal here (this
 * `.catch()` is what keeps a triage error from ever breaking inbound-message
 * processing), but conflating the two would make a capped tenant look like a
 * recurring bug every time WhatsApp messages come in.
 */
function logTriageOutcome(context: string, err: unknown): void {
  if (err instanceof AiCapError) {
    console.error(`[triage] ${context} skipped — tenant is over its monthly AI cap`);
  } else {
    console.error(`[triage] ${context} failed:`, err);
  }
}

export const dynamic = "force-dynamic";

/**
 * Inbound + delivery-status webhook from the WhatsApp bridge provider. Public
 * (in middleware) but secret-verified here. Always 200 on a verified call so the
 * provider doesn't retry on our no-ops; 401 only for an unverified caller.
 *
 * TENANCY: this is a PUBLIC server-to-server callback (no session cookie), so it
 * must NOT touch the request-scoped `db` proxy directly — that silently falls
 * back to the default tenant. Unlike the inbound-leads webhook (now per-tenant
 * API-keyed), the WhatsApp bridge is a SINGLE GLOBAL instance by design: its
 * credentials live in one tenant's settings (see lib/whatsapp/config.ts —
 * "single instance for now; per-tenant in the tenancy phase"), the provider
 * calls ONE webhook URL with ONE shared secret, and the inbound payload carries
 * no tenant identifier to route on. So we bind the whole handler EXPLICITLY via
 * runWithTenant to the one active tenant that holds a WhatsApp token — the
 * tenant that connected the bridge is the tenant its messages belong to. This
 * used to be hardcoded to the original tenant's slug, which kept routing the
 * clinic's WhatsApp into a retired account after the business moved tenants.
 * Every `db` access below — and the fire-and-forget triage it spawns — then
 * resolves to that one tenant deterministically.
 *
 * TODO(per-tenant WhatsApp): when the bridge becomes per-tenant, resolve the
 * owning tenant from the inbound channel/number → tenant mapping here (e.g. a
 * control-plane whatsapp_channels table) instead of the single configured one.
 */
function whatsAppTenant(slug: string | null) {
  // Per business: the webhook address carries the business (?t=<slug>), so
  // each gym's WhatsApp lands in its own account. Without it, the old single
  // connection: the one business holding a WhatsApp token.
  if (slug) {
    const t = listTenants().find((x) => x.slug === slug && x.isActive !== false);
    if (!t) return undefined;
    // The token is stored sealed (tokenEnc) since 2026-10-22; read it through
    // the config module, never the raw settings row.
    return isWhatsAppConfiguredForTenant(t.id) ? t : undefined;
  }
  return listTenants().find((t) => t.isActive !== false && isWhatsAppConfiguredForTenant(t.id));
}

export async function POST(req: NextRequest) {
  const tenant = whatsAppTenant(new URL(req.url).searchParams.get("t"));
  if (!tenant) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return runWithTenant(tenant.id, async () => {
    if (!isWhatsAppConfigured()) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    const bridge = getWhatsAppBridge();

    const url = new URL(req.url);
    // The secret comes in the x-webhook-secret header. In the address only
    // until the business moves it (Settings > WhatsApp); after that an
    // address secret is refused, so one leaked from a log is useless.
    const headerSecret = req.headers.get("x-webhook-secret");
    const secret = headerSecret ?? (getWhatsAppConfig().webhookHeaderMode ? null : url.searchParams.get("secret"));
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
        ingestWhatsAppMediaLater(tenant.id, "client", inboundMsg.id, bridge, inbound);
        await logActivity(
          "whatsapp.inbound",
          `WhatsApp reply from ${client.firstName} ${client.lastName}`.trim(),
          { clientId: client.id },
        );
        // STOP on its own turns off news and offers by WhatsApp, and says so.
        if (isStopReply(inbound.text) && isOptedIn(client.id)) {
          const business = getBusinessProfileForTenant(tenant.id).businessName;
          recordConsent(tenant.id, client, business, "sms", false, "unsubscribe");
          const reply = `You won't get news and offers from ${business} on WhatsApp again. Messages about your bookings still come.`;
          try {
            const { providerMessageId } = await bridge.sendText(client.phone, reply);
            addClientMessage({ clientId: client.id, direction: "outbound", channel: "whatsapp", content: reply, providerMessageId, status: "sent", sentAt: new Date() });
          } catch (err) {
            console.error("[whatsapp] stop confirmation failed:", err);
          }
        }
        try {
          // The reply carries no messageId: the id is a client message's, which the
          // Thinking about it reply check cannot match (its 15-minute fallback covers it).
          const reply = { text: inbound.text, channel: "whatsapp" };
          if (!onInboundFromClient(client.id, reply)) {
            // No lead is linked to this client, but a lead may share the number.
            const sameNumber = findLeadByPhone(inbound.fromPhone);
            if (sameNumber) onInboundFromLead(sameNumber.id, reply);
          }
        } catch (err) {
          console.error("[pipeline] client inbound hook failed:", err);
        }
        notifyInboundMessage({
          channel: "whatsapp",
          owner: "client",
          contactId: client.id,
          name: `${client.firstName} ${client.lastName}`.trim(),
          text: inbound.text,
          messageId: inboundMsg.id,
          providerMessageId: inbound.providerMessageId,
        });
        // Triage in the background — never block the webhook ack.
        void runTriage({
          ownerType: "client",
          ownerId: client.id,
          messageId: inboundMsg.id,
          messageText: inbound.text,
          channel: "whatsapp",
        }).catch((err) => logTriageOutcome("client inbound", err));
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
        ingestWhatsAppMediaLater(tenant.id, "lead", inboundMsg.id, bridge, inbound);
        setLeadStatus(lead.id, "replied");
        // STOP withdraws the lead's marketing consent (fail-soft).
        withdrawConsentOnStopReply(lead.id, inbound.text);
        try {
          onInboundFromLead(lead.id, { text: inbound.text, messageId: inboundMsg.id, channel: "whatsapp" });
        } catch (err) {
          console.error("[pipeline] lead inbound hook failed:", err);
        }
        await logActivity(
          "whatsapp.inbound",
          `WhatsApp reply from ${inbound.fromPhone}`,
          { leadId: lead.id },
        );
        notifyInboundMessage({
          channel: "whatsapp",
          owner: "lead",
          contactId: lead.id,
          name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || inbound.fromPhone,
          text: inbound.text,
          messageId: inboundMsg.id,
          providerMessageId: inbound.providerMessageId,
        });
        void runTriage({
          ownerType: "lead",
          ownerId: lead.id,
          messageId: inboundMsg.id,
          messageText: inbound.text,
          channel: "whatsapp",
        }).catch((err) => logTriageOutcome("lead inbound", err));
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
      // A follow-up flow's first WhatsApp that never arrived: Message undelivered, the rest by email.
      if (status.status === "failed") {
        try {
          await onWhatsAppDeliveryFailed(tenant.id, status.providerMessageId);
        } catch (err) {
          console.error("[lead flows] undelivered handling failed:", err);
        }
      }
    }

    return NextResponse.json({ ok: true });
  });
}
