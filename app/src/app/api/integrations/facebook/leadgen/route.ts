import { runWithTenant } from "@/lib/db/tenant";
import { verifyFacebookSignature, parseLeadgenEvents } from "@/lib/facebook/webhook";
import { getFacebookPageByPageId, fetchLeadAsInput } from "@/lib/facebook/pages";
import { upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Facebook `leadgen` webhook — Phase 1 of the native Meta integration; the
 * instant counterpart to the Make/Zapier → /api/leads/inbound polling path.
 *
 * GET  = Facebook's subscription verification: echo `hub.challenge` when
 *        `hub.verify_token` matches FACEBOOK_WEBHOOK_VERIFY_TOKEN (fail-closed —
 *        403 if the token is unset or wrong, so an unconfigured deploy can never
 *        complete a subscription).
 * POST = a signed leadgen notification. FB only sends a leadgen_id + page_id, so
 *        we resolve the owning tenant + Page token from page_id (control-plane
 *        facebook_pages), fetch the full lead via the Graph API, and upsert it
 *        into that tenant — reusing upsertLead (fullName split, source=facebook +
 *        leadgen id for dedup, same as the Make path).
 *
 * Public (see middleware PUBLIC_API_PREFIXES) but signature-verified here. Same
 * shape as the Mailgun webhook: always 200 once the signature verifies (even a
 * no-op) so FB never retry-storms; 401 ONLY for a bad/missing signature.
 * Server-to-server (no cookie) → NEVER the ambient `db` proxy; tenant is
 * resolved from page_id and every write runs inside runWithTenant.
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

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifyFacebookSignature(rawBody, req.headers.get("x-hub-signature-256"), process.env.FACEBOOK_APP_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Verified but not JSON — a permanent no-op, so 200 (don't make FB retry).
    return Response.json({ ok: true, ignored: "unparseable" });
  }

  for (const ev of parseLeadgenEvents(payload)) {
    try {
      const page = getFacebookPageByPageId(ev.pageId);
      if (!page) continue; // Page not connected to any tenant — ignore (never a default-tenant write).
      const input = await fetchLeadAsInput(ev.leadgenId, page.pageAccessToken);
      await runWithTenant(page.tenantId, async () => {
        const { lead, created } = upsertLead(input);
        if (created) {
          const name =
            [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
            lead.email ||
            lead.phone ||
            "anonymous";
          await logActivity("lead.new", `New lead via facebook: ${name}`, { leadId: lead.id });
        }
      });
    } catch (err) {
      // One lead failing must never crash a verified webhook (FB must not retry).
      console.error(`[facebook leadgen] failed for lead ${ev.leadgenId}:`, err);
    }
  }

  return Response.json({ ok: true });
}
