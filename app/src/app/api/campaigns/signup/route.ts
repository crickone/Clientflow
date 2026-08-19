import { NextResponse, type NextRequest } from "next/server";

import { getCampaignBySlug } from "@/lib/campaigns/store";
import { isHoneypotTripped, validateSignup } from "@/lib/campaigns/signup";
import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { runWithTenant } from "@/lib/db/tenant";
import { upsertLead } from "@/lib/leads";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024; // one signup submission, not a bulk payload — same cap as /api/leads/inbound
const RATE_LIMIT = 30; // requests per IP…
const RATE_WINDOW_MS = 60 * 1000; // …per minute

/**
 * Public campaign-landing signup (Campaign Engine Slice 2, Task 2). Task 3's
 * `/site/<slug>/c/<campaignSlug>` landing page POSTs here with NO API key —
 * unlike `/api/leads/inbound` (keyed integrations), a browser can't hold a
 * secret, so this endpoint proves tenancy a different way: the tenant is
 * resolved from the request's HOST via `resolvePublicSite` (the control-plane
 * `site_domains` table — the exact same trust basis the public CMS itself
 * renders on). The request body is NEVER trusted for tenant identity; it
 * carries no tenant id field at all, and `siteSlug` (used only for the
 * dev/no-mapped-host fallback) still resolves through the same
 * `resolvePublicSite` lookup rather than being taken at face value.
 *
 * Once the tenant is resolved, the campaign lookup + lead write both run
 * inside `runWithTenant(site.tenantId, …)`, so a `campaignSlug` naming
 * another tenant's campaign simply isn't found — there is no row to leak
 * into or attribute a lead to. Structural guard: per-tenant DB, not a
 * runtime check.
 *
 * Hardening mirrors /api/leads/inbound: request-size cap, per-IP rate-limit,
 * runWithTenant, and the same `{ok, ...}` response shape. Two things this
 * route adds that /api/leads/inbound doesn't need: a honeypot (this is a
 * public HTML form with no other bot defence — no CAPTCHA, no API key to
 * gate access at all), and the host-based tenant resolution above (in place
 * of the API-key lookup /api/leads/inbound uses instead).
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

  // 3. Validate the real fields (name, campaignSlug, at-least-one-contact,
  //    email format, length caps — see lib/campaigns/signup.ts).
  const validated = validateSignup(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }
  const { name, email, phone, message, campaignSlug } = validated.data;

  // 4. Resolve tenant+site from the HOST (prod) or body.siteSlug (dev
  //    fallback, mirrors the public CMS's own ?site= dev path) — this is the
  //    ONLY source of tenant identity for the whole request. There is no
  //    tenant id field anywhere in the accepted body shape.
  const bodyObj = body as Record<string, unknown>;
  const siteSlugParam = typeof bodyObj.siteSlug === "string" ? bodyObj.siteSlug : null;
  const site = resolvePublicSite({ host: req.headers.get("host"), siteParam: siteSlugParam });
  if (!site) {
    return NextResponse.json({ ok: false, error: "Unknown site." }, { status: 400 });
  }

  // 5. Throttle per IP so nobody can flood the pipeline / fill the disk.
  const rl = rateLimit(`campaign-signup:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // 6. The campaign lookup + lead upsert both run bound to the HOST-resolved
  //    tenant (never a client-supplied one), so a campaignSlug belonging to
  //    another tenant just isn't found here.
  const result = await runWithTenant(site.tenantId, async () => {
    const campaign = getCampaignBySlug(campaignSlug);
    if (!campaign) return { notFound: true as const };

    // Stable dedupe key so a double-submit (double-click, retry after a
    // flaky network) doesn't create two leads — upsertLead is idempotent on
    // (source, sourceLeadId). validateSignup already guarantees email||phone
    // is non-empty, so this key is always meaningful (never
    // "landing:<slug>:").
    const sourceLeadId = `landing:${campaignSlug}:${(email || phone || "").toLowerCase()}`;

    upsertLead({
      source: "landing",
      sourceLeadId,
      campaign: campaign.name,
      fullName: name,
      email: email || null,
      phone: phone || null,
      notes: message || null,
      rawPayload: body,
    });

    return { notFound: false as const };
  });

  if (result.notFound) {
    return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
