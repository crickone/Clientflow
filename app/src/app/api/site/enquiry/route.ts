import { clientIp, rateLimit } from "@/lib/rateLimit";
import { runWithTenant } from "@/lib/db/tenant";
import { upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { verifySiteEnquiryToken } from "@/lib/cms/enquiryToken";
import { enquiryNotes, isEnquiryHoneypotTripped, safeReturnPath, validateEnquiry } from "@/lib/cms/enquiry";
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
  const returnTo = safeReturnPath(fields.return);

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

  const validated = validateEnquiry(fields);
  if (!validated.ok) return respondPublicForm(req, returnTo, false, { status: 400, error: validated.error });
  const data = validated.data;

  const claim = verifySiteEnquiryToken(fields.token ?? "");
  if (!claim) return respondPublicForm(req, returnTo, false, { status: 400, error: "Invalid or missing token." });

  // Stable dedupe key so a double-click or a second enquiry from the same
  // person updates one card rather than adding a twin (upsertLead is
  // idempotent on source + sourceLeadId). validateEnquiry guarantees one of
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
      notes: enquiryNotes(data),
    });
    await logActivity(
      "lead.new",
      created ? `Website enquiry: ${data.name}` : `Repeat website enquiry: ${data.name}`,
      { leadId: lead.id, programme: data.programme, siteId: claim.siteId, created },
    );
    return { leadId: lead.id, created };
  });

  return respondPublicForm(req, returnTo, true, { extra: { leadId: result.leadId, created: result.created } });
}
