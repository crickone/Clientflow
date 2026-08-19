import { NextResponse, type NextRequest } from "next/server";

import { getCampaign } from "@/lib/campaigns/store";
import { isHoneypotTripped, validateSignup } from "@/lib/campaigns/signup";
import { verifyCampaignSignupToken } from "@/lib/campaigns/signupToken";
import { runWithTenant } from "@/lib/db/tenant";
import { upsertLead } from "@/lib/leads";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024; // one signup submission, not a bulk payload — same cap as /api/leads/inbound
const RATE_LIMIT = 30; // requests per IP…
const RATE_WINDOW_MS = 60 * 1000; // …per minute

/**
 * Public campaign-landing signup (Campaign Engine Slice 2, Task 2; rewritten
 * in "Fix wave 1" — see the Task 2 report's "Fix wave 1" section — to close a
 * CRITICAL cross-tenant lead-injection vulnerability in commit 89c08ad).
 *
 * Task 3's `/site/<slug>/c/<campaignSlug>` landing page POSTs here with NO
 * API key — unlike `/api/leads/inbound` (keyed integrations), a browser
 * can't hold a secret. Tenancy is proven with a server-signed `token`
 * (`lib/campaigns/signupToken.ts`): the landing page mints it at render
 * time, encoding `{tenantId, campaignId}` and HMAC-signed with a server-only
 * secret; this route's only job is to verify it. The request body carries no
 * OTHER tenant/campaign identifier — not a `siteSlug`, not a `campaignSlug`
 * — so there is nothing in client input an attacker could substitute to name
 * a different tenant's campaign. Forging a token requires the server secret,
 * which the client never has.
 *
 * This replaces the original (commit 89c08ad) design, which resolved the
 * tenant via `resolvePublicSite({host, siteParam: body.siteSlug})`. That was
 * forgeable: `resolvePublicSite`'s dev/unmapped-host fallback searches EVERY
 * tenant's DB for a site matching a client-supplied `siteParam`, and an
 * attacker can trivially arrange an unmapped Host in production (e.g. the
 * platform's own default host). POSTing a victim's `siteSlug`+`campaignSlug`
 * against an unmapped host resolved the VICTIM tenant and wrote a lead into
 * their CRM — a full cross-tenant write bypass, plus a slug-enumeration
 * oracle via the distinct 400/404 responses. The "tenant comes only from the
 * host, never client input" invariant the old code's comments claimed was
 * false in practice. The token design removes host/slug from the trust chain
 * entirely — this now works identically, and safely, on any host (platform
 * default or a verified custom domain).
 *
 * Hardening mirrors /api/leads/inbound: request-size cap, per-IP rate-limit
 * — moved as early as the honeypot check, BEFORE any DB read or HMAC verify,
 * so an attacker can't dodge the throttle by sending invalid/unresolvable
 * requests — runWithTenant, and the same `{ok, ...}` response shape. Also
 * gates on campaign lifecycle: `status` must be `ready` or `active`, so a
 * `building` campaign can't take sign-ups even if its token were somehow
 * obtained early (e.g. a preview link).
 */
export async function POST(req: NextRequest) {
  // 1. Cap the payload size before buffering it. Mirrors /api/leads/inbound:
  //    a cheap Content-Length pre-check, then the authoritative check on the
  //    actual decoded text (a caller can lie about/omit Content-Length).
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be valid JSON." }, { status: 400 });
  }

  // 2. Honeypot: a bot that fills every field it finds trips this hidden
  //    field. Drop it silently — 200 {ok:true}, no lead created — rather
  //    than a 4xx, which would tell the bot which field to leave blank next
  //    time.
  if (isHoneypotTripped(body)) {
    return NextResponse.json({ ok: true });
  }

  // 3. Throttle per IP FIRST — before any DB read or HMAC verify — so
  //    nobody can flood the pipeline / fill the disk, and an invalid or
  //    unresolvable request still counts against the caller's budget (no
  //    free pre-throttle scan of any kind).
  const rl = rateLimit(`campaign-signup:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // 4. Validate the real fields (name, at-least-one-contact, email format,
  //    length caps — see lib/campaigns/signup.ts). `campaignSlug` is no
  //    longer part of this shape; the token (next step) replaces it as the
  //    campaign identifier.
  const validated = validateSignup(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }
  const { name, email, phone, message } = validated.data;

  // 5. Verify the signed token — the ONLY source of tenant+campaign identity
  //    for the whole request. No host, no client-supplied slug of any kind.
  const bodyObj = body as Record<string, unknown>;
  const claim = verifyCampaignSignupToken(String(bodyObj.token ?? ""));
  if (!claim) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing signup token." },
      { status: 400 },
    );
  }

  // 6. The campaign lookup + lead upsert both run bound to the TOKEN-resolved
  //    tenant (never a client-supplied or host-derived one), so there is no
  //    code path left that could write into a different tenant's DB.
  const result = await runWithTenant(claim.tenantId, async () => {
    const campaign = getCampaign(claim.campaignId);
    if (!campaign) return { notFound: true } as const;
    if (campaign.status !== "ready" && campaign.status !== "active") {
      return { notLive: true } as const;
    }

    // Stable dedupe key so a double-submit (double-click, retry after a
    // flaky network) doesn't create two leads — upsertLead is idempotent on
    // (source, sourceLeadId). validateSignup already guarantees email||phone
    // is non-empty, so this key is always meaningful (never "landing:<id>:").
    const sourceLeadId = `landing:${claim.campaignId}:${(email || phone || "").toLowerCase()}`;

    upsertLead({
      source: "landing",
      sourceLeadId,
      campaign: campaign.name,
      fullName: name,
      email: email || null,
      phone: phone || null,
      notes: message || null,
    });

    return { ok: true } as const;
  });

  if ("notFound" in result) {
    return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  }
  if ("notLive" in result) {
    return NextResponse.json(
      { ok: false, error: "This campaign isn't accepting sign-ups yet." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
