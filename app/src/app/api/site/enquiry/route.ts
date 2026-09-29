import { eq } from "drizzle-orm";

import { clientIp, rateLimit } from "@/lib/rateLimit";
import { getTenantDbById, runWithTenant } from "@/lib/db/tenant";
import { sites } from "@/lib/db/schema";
import { appendLeadNotes, upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { reopenLostLead } from "@/lib/pipeline/stage";
import { verifySiteEnquiryToken, type SiteEnquiryClaim } from "@/lib/cms/enquiryToken";
import {
  enquiryNotes,
  isEnquiryHoneypotTripped,
  safeReturnPath,
  sameOriginRefererPath,
  validateEnquiry,
} from "@/lib/cms/enquiry";
import { parsePublicFormFields, respondPublicForm } from "@/lib/publicFormExchange";

export const dynamic = "force-dynamic";

/**
 * Public enquiry handler for bespoke tenant sites (first used by Healthwise).
 * Unauthenticated and unkeyed. The tenant comes ONLY from the signed token
 * the verbatim template minted into the page (lib/cms/enquiryToken.ts) —
 * the same model as api/campaigns/signup/route.ts, whose header explains why
 * host- or slug-based resolution is not safe here. Protections mirror
 * f/[slug]/submit/route.ts: size cap before parsing, honeypot, per-IP
 * throttle; the JSON-or-url-encoded exchange itself is shared with that
 * route (lib/publicFormExchange.ts).
 *
 * Plain Request/Response, not next/server, so the route loads in the test
 * runner (see f/[slug]/submit/route.ts for the same choice).
 */
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * The slug of the site the claim names, or null.
 *
 * The programme list belongs to the site (lib/cms/enquiry.ts), so the server
 * has to learn WHICH site from something the browser cannot edit. That is the
 * signed claim, never a field in the body: a slug the caller posts would let
 * them pick the list they are checked against, and a check you can choose your
 * own answer to is not a check.
 *
 * Null when the tenant or the site is no longer there. A claim naming a site
 * that does not exist cannot say what that site's form offered, so the route
 * answers it as it answers every other unusable token rather than falling back
 * to some other site's list.
 */
function siteSlugFromClaim(claim: SiteEnquiryClaim): string | null {
  try {
    const row = getTenantDbById(claim.tenantId)
      .select({ slug: sites.slug })
      .from(sites)
      .where(eq(sites.id, claim.siteId))
      .get();
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return respondPublicForm(req, "/contact", false, { status: 413, error: "That message is too long." });
  }
  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return respondPublicForm(req, "/contact", false, { status: 413, error: "That message is too long." });
  }

  let fields: Record<string, string>;
  try {
    fields = parsePublicFormFields(req, rawText);
  } catch {
    return respondPublicForm(req, "/contact", false, { status: 400, error: "Please check the form and try again." });
  }
  const returnTo = safeReturnPath(sameOriginRefererPath(req.headers.get("referer"), req.url) ?? fields.return);

  // Honeypot: a bot that fills every field gets a quiet success and nothing stored.
  if (isEnquiryHoneypotTripped(fields)) return respondPublicForm(req, returnTo, true);

  const rl = rateLimit(`site-enquiry:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return respondPublicForm(req, returnTo, false, {
      status: 429,
      error: "Too many messages — please try again shortly.",
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }

  // The claim is read BEFORE the fields, because it names the site and a
  // programme can only be checked against the list that site's own form
  // offers. It also keeps a caller with no usable claim out of the validator
  // altogether. Nothing that was already answered changes its answer: a
  // request with good fields and a bad token was refused for the token
  // before, and one with a good token and bad fields is still refused for the
  // fields.
  const claim = verifySiteEnquiryToken(fields.token ?? "");
  const siteSlug = claim ? siteSlugFromClaim(claim) : null;
  if (!claim || !siteSlug) {
    return respondPublicForm(req, returnTo, false, { status: 400, error: "Invalid or missing token." });
  }

  const validated = validateEnquiry(fields, siteSlug);
  if (!validated.ok) return respondPublicForm(req, returnTo, false, { status: 400, error: validated.error });
  const data = validated.data;

  // Stable dedupe key so a double-click or a second enquiry from the same
  // person lands on one card rather than a twin (upsertLead is idempotent on
  // source + sourceLeadId). A repeat's programme/about is not discarded: it
  // is appended to the existing lead's notes below, so nothing the visitor
  // typed the second time round is lost. validateEnquiry guarantees one of
  // email/phone is present.
  const contactKey = (data.email || data.phone || "").toLowerCase().replace(/\s+/g, "");
  const result = await runWithTenant(claim.tenantId, async () => {
    const { lead, created } = upsertLead({
      source: "website",
      sourceLeadId: `website:${contactKey}`,
      campaign: "Website enquiry",
      fullName: data.name,
      email: data.email,
      phone: data.phone,
      notes: enquiryNotes(data, siteSlug),
    });
    // A lead the business had written off is put back on the board when the
    // person enquires again: they are asking to be contacted, so the card has
    // to be somewhere the operator will see it. Only a `lost` lead reopens —
    // lib/pipeline/stage.ts carries which roles qualify and why.
    let reopened = false;
    if (!created) {
      appendLeadNotes(
        lead.id,
        `Repeat enquiry ${new Date().toISOString().slice(0, 10)}: ${enquiryNotes(data, siteSlug).replace(/\n/g, " · ")}`,
      );
      reopened = reopenLostLead(lead.id, `Reopened by a repeat website enquiry from ${data.name}`);
    }
    await logActivity(
      "lead.new",
      created
        ? `Website enquiry: ${data.name}`
        : reopened
          ? `Repeat website enquiry reopened a lost lead: ${data.name}`
          : `Repeat website enquiry: ${data.name}`,
      { leadId: lead.id, programme: data.programme, siteId: claim.siteId, created, reopened, about: data.about },
    );
    return { leadId: lead.id, created, reopened };
  });

  return respondPublicForm(req, returnTo, true, { extra: { leadId: result.leadId, created: result.created, reopened: result.reopened } });
}
