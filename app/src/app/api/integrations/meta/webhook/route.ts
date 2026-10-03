import { runWithTenant } from "@/lib/db/tenant";
import { verifyFacebookSignature, parseLeadgenEvents, parseMessagingEvents } from "@/lib/facebook/webhook";
import { getFacebookPageByPageId, fetchLeadAsInput, getPageForMessagingAccount } from "@/lib/facebook/pages";
import { upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { recordDmEvent } from "@/lib/social/dm";
import { runTriage } from "@/lib/inbox/triagePipeline";
import { onInboundFromClient, onInboundFromLead } from "@/lib/pipeline/stage";
import { AiCapError } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

/**
 * The Meta app's webhook: one callback URL for the `page` object (lead ads +
 * Messenger) and the `instagram` object (Instagram DMs). Meta allows one URL
 * per object, so every field we subscribe to lands here.
 *
 * GET  = subscription verification: echo `hub.challenge` when `hub.verify_token`
 *        matches FACEBOOK_WEBHOOK_VERIFY_TOKEN (fail-closed: 403 if unset/wrong).
 * POST = a signed event batch (X-Hub-Signature-256 over the raw body with the
 *        app secret). Each event resolves its tenant from the Page / Instagram
 *        account it names (control-plane facebook_pages) and every write runs
 *        inside runWithTenant; an unconnected Page is ignored, never written to
 *        a default tenant. Always 200 once the signature verifies, so Meta never
 *        retry-storms; 401 only for a bad signature.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

function logTriageOutcome(context: string, err: unknown): void {
  if (err instanceof AiCapError) console.error(`[triage] ${context} skipped — tenant is over its monthly AI cap`);
  else console.error(`[triage] ${context} failed:`, err);
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifyFacebookSignature(rawBody, req.headers.get("x-hub-signature-256"), process.env.FACEBOOK_APP_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: true, ignored: "unparseable" });
  }

  // One line per delivery, so a test DM or lead can be traced in the logs.
  // Counts and object type only: never message text or a person's id.
  const leadEvents = parseLeadgenEvents(payload);
  const dmEvents = parseMessagingEvents(payload);
  const object = (payload as { object?: unknown } | null)?.object;
  console.log(`[meta webhook] ${String(object ?? "unknown")}: ${leadEvents.length} lead(s), ${dmEvents.length} message event(s)`);

  // ── Lead ads ──
  for (const ev of leadEvents) {
    try {
      const page = getFacebookPageByPageId(ev.pageId);
      if (!page) {
        console.log(`[meta webhook] lead for Page ${ev.pageId}: no connected Page matches, ignored`);
        continue;
      }
      const input = await fetchLeadAsInput(ev.leadgenId, page.pageAccessToken);
      await runWithTenant(page.tenantId, async () => {
        const { lead, created } = upsertLead(input);
        if (created) {
          const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.email || lead.phone || "anonymous";
          await logActivity("lead.new", `New lead via facebook: ${name}`, { leadId: lead.id });
        }
      });
    } catch (err) {
      console.error(`[meta webhook] lead ${ev.leadgenId} failed:`, err);
    }
  }

  // ── Messenger + Instagram DMs ──
  for (const ev of dmEvents) {
    try {
      const page = getPageForMessagingAccount(ev.channel, ev.accountId);
      if (!page) {
        console.log(`[meta webhook] ${ev.channel} message for account ${ev.accountId}: no connected Page matches, ignored`);
        continue;
      }
      await runWithTenant(page.tenantId, async () => {
        const inbound = await recordDmEvent(ev, page);
        if (!inbound) return;
        try {
          if (inbound.ownerType === "lead") onInboundFromLead(inbound.ownerId);
          else onInboundFromClient(inbound.ownerId);
        } catch (err) {
          console.error("[pipeline] DM inbound hook failed:", err);
        }
        void runTriage({
          ownerType: inbound.ownerType,
          ownerId: inbound.ownerId,
          messageId: inbound.messageId,
          messageText: ev.text,
          channel: ev.channel,
        }).catch((err) => logTriageOutcome(`${ev.channel} inbound`, err));
      });
    } catch (err) {
      console.error(`[meta webhook] ${ev.channel} message ${ev.messageId} failed:`, err);
    }
  }

  return Response.json({ ok: true });
}
