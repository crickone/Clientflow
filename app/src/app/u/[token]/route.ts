import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getTenantById, getTenantDbById } from "@/lib/db/tenant";
import { contacts } from "@/lib/db/schema";
import { parseUnsubscribeToken } from "@/lib/marketing/unsubscribeToken";
import { suppress } from "@/lib/marketing/suppress";

// Public unsubscribe link (Task 6). Fully unauthenticated — no cookie, no
// session, no admin check — allow-listed in middleware.ts alongside the
// public form share links (/f/). Self-authorizes entirely off the signed
// token: parseUnsubscribeToken embeds + verifies (tenantId, contactId), so
// there is nothing else to check. See lib/marketing/unsubscribeToken.ts for
// why the token has no expiry and isn't single-use (a recipient may click at
// any time, possibly twice).
//
// `force-dynamic`: this must never be statically generated/cached — the
// token is in the path, and every request needs a fresh DB read/write.
export const dynamic = "force-dynamic";

/**
 * GET only: an unsubscribe link is something a mail client / a browser / a
 * link-scanning security proxy fetches with a plain navigation — there's no
 * form to submit and no reason to require POST here.
 *
 * NEVER throws to the caller: every failure path (bad/tampered token,
 * unknown tenant, unknown contact, an unexpected DB error) falls through to
 * the SAME generic "invalid" page, at 200 — so this endpoint can never be
 * used to probe whether a given token/tenant/contact exists. Idempotent:
 * suppress() is itself idempotent, so clicking twice is harmless.
 */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  try {
    const claim = parseUnsubscribeToken(params.token);
    if (!claim) return invalidPage();

    // A tenant id can be well-formed (the token verified) yet no longer
    // resolve — e.g. the tenant was offboarded after this campaign was sent.
    // getTenantById/getTenantDbById would throw on an unknown id; treat that
    // exactly like an invalid token rather than letting it 500.
    const tenant = getTenantById(claim.tenantId);
    if (!tenant) return invalidPage();

    const tdb = getTenantDbById(claim.tenantId);
    const contact = tdb
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, claim.contactId))
      .get();
    // The contact could have been deleted since the campaign was sent — the
    // token still verifies (it only proves *this app* minted it), but there's
    // no email left to suppress. Same generic page as an invalid token: never
    // reveal which case it was.
    if (!contact) return invalidPage();

    suppress(claim.tenantId, contact.email, "unsubscribe");

    return confirmedPage(tenant.name);
  } catch (err) {
    console.error("[marketing] /u/[token] failed:", err);
    return invalidPage();
  }
}

const PAGE_STYLE = `
  color-scheme: dark;
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0b0d12;
  color: #e7e9ee;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding: 24px;
`;
const CARD_STYLE = `
  max-width: 440px;
  width: 100%;
  background: #12151c;
  border: 1px solid #23262f;
  border-radius: 16px;
  padding: 40px 32px;
  text-align: center;
`;
const HEADING_STYLE = `margin: 0 0 12px; font-size: 22px; font-weight: 600; color: #f4f5f7;`;
const BODY_STYLE = `margin: 0; font-size: 15px; line-height: 1.6; color: #9ca0ab;`;

function htmlPage(opts: { title: string; heading: string; body: string }): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="${PAGE_STYLE}">
<div style="${CARD_STYLE}">
<h1 style="${HEADING_STYLE}">${escapeHtml(opts.heading)}</h1>
<p style="${BODY_STYLE}">${opts.body}</p>
</div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** Same generic page for EVERY failure case (bad signature, malformed token,
 *  unknown tenant, unknown contact, unexpected error) — never leaks why. */
function invalidPage(): NextResponse {
  return htmlPage({
    title: "Link invalid",
    heading: "This link is invalid or expired",
    body: "It may have already been used, or the link was copied incorrectly. If you're trying to stop receiving emails from us, please contact the business directly and we'll take care of it.",
  });
}

function confirmedPage(businessName: string): NextResponse {
  return htmlPage({
    title: "Unsubscribed",
    heading: "You've been unsubscribed",
    body: `You won't receive any further marketing emails from ${escapeHtml(businessName)}. If this was a mistake, just contact us directly and we'll add you back.`,
  });
}

/** Minimal HTML-entity escaping for values interpolated into the page (a
 *  tenant's business name is operator-set, not attacker input, but this
 *  costs nothing and keeps the page well-formed regardless). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
