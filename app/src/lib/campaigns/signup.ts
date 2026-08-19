/**
 * Pure validation + honeypot check for the public campaign-landing signup
 * endpoint (POST /api/campaigns/signup — Campaign Engine Slice 2, Task 2).
 * Zero imports — loads under the plain tsx test runner with no DB/Next
 * module graph behind it, mirrors src/lib/campaigns/plan.ts / assetBody.ts.
 *
 * This module does NOT decide tenancy or campaign identity — it only
 * shapes/validates the human-entered fields (name/contact/message). The
 * route (src/app/api/campaigns/signup/route.ts) is a thin wrapper: size cap
 * → JSON.parse → isHoneypotTripped → rateLimit → validateSignup →
 * verifyCampaignSignupToken → runWithTenant(upsertLead).
 *
 * "Fix wave 1" (closing a CRITICAL cross-tenant lead-injection hole in the
 * original commit 89c08ad — see the Task 2 report's "Fix wave 1" section)
 * removed `campaignSlug` from this module entirely. The route used to trust
 * a client-supplied `campaignSlug` (paired with a host/siteSlug tenant
 * resolution that turned out to be forgeable) to pick WHICH campaign a lead
 * was attributed to; it's now resolved from a server-signed token
 * (`lib/campaigns/signupToken.ts`) that the route verifies separately, so
 * there's no campaign/tenant identifier left in the human-entered submission
 * shape at all — a client literally cannot name one.
 */

/** Fields a submission "belongs" to before validation — every value is
 *  `unknown` because it comes straight from `JSON.parse` on a public,
 *  unauthenticated request body. */
export interface SignupInput {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  /** Hidden honeypot field. Real visitors never see or fill it (CSS-hidden
   *  in the form); a bot that fills every input it finds trips it. */
  website?: unknown;
}

export interface ValidSignup {
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
}

export type ValidateSignupResult =
  | { ok: true; data: ValidSignup }
  | { ok: false; error: string };

// Same pattern as lib/marketing/contactImport.ts's / lib/memberImport.ts's
// EMAIL_RE — good enough to catch "obviously not an email" without the false
// positives/negatives of a "fully correct" RFC 5322 regex.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// name/email/phone are short, single-line fields — 200 chars is generous
// headroom over any real value. `message` is free text a visitor might
// actually write a paragraph into, so it gets a longer cap (matches the
// equivalent field on the sibling public-lead endpoint, site-demo-lead's
// `message: z.string().max(2000)`).
const MAX_FIELD_LEN = 200;
const MAX_MESSAGE_LEN = 2000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * True when the hidden honeypot field is non-empty. Real visitors never see
 * or fill it, so any value at all means a bot filled every field it found.
 * The route treats a trip as silent success (200 `{ok:true}`, no lead
 * created) rather than a 4xx — a rejection would tell the bot which field to
 * leave blank next time.
 */
export function isHoneypotTripped(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  return asString(obj.website).length > 0;
}

/**
 * Validate a public signup submission. Requires a non-empty `name`, plus at
 * least one of `email`/`phone` — a lead with neither is unreachable, and the
 * route's dedupe key is keyed on `email || phone`, so it would degenerate
 * without this. A present `email` must look like an email address (format
 * only — no MX/deliverability check). Every string field is trimmed and
 * length-capped so a hostile payload can't stuff an oversized value into a
 * DB column (the route's own request-size cap already bounds the payload as
 * a whole; this is a second, per-field check that also runs standalone in
 * tests, DB-free).
 *
 * Does NOT validate a campaign identifier — see this file's module doc
 * ("Fix wave 1"): the route resolves tenant+campaign from a separately
 * verified signed token, not from anything in this body shape.
 */
export function validateSignup(body: unknown): ValidateSignupResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid request body." };
  }
  const obj = body as Record<string, unknown>;

  const name = asString(obj.name);
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > MAX_FIELD_LEN) {
    return { ok: false, error: "Name is too long." };
  }

  const email = asString(obj.email);
  if (email.length > MAX_FIELD_LEN) {
    return { ok: false, error: "Email is too long." };
  }
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const phone = asString(obj.phone);
  if (phone.length > MAX_FIELD_LEN) {
    return { ok: false, error: "Phone number is too long." };
  }

  if (!email && !phone) {
    return { ok: false, error: "Enter an email address or phone number." };
  }

  const message = asString(obj.message);
  if (message.length > MAX_MESSAGE_LEN) {
    return { ok: false, error: "Message is too long." };
  }

  return {
    ok: true,
    data: {
      name,
      email: email || null,
      phone: phone || null,
      message: message || null,
    },
  };
}
