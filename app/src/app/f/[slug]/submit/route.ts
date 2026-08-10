import { clientIp, rateLimit } from "@/lib/rateLimit";
import { runWithTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { buildAnswers, insertFormSubmission, resolveFormBySlug, validateRequired } from "@/lib/publicForms";

export const dynamic = "force-dynamic";

/**
 * Public submit handler for `/f/<slug>` (Batch 4c, improvement-plan-2026-08.md
 * Theme D5). Unauthenticated and unkeyed, like api/site-demo-lead/route.ts —
 * mirrors its protections: honeypot, per-IP rate limit, and a hard
 * payload-size cap read BEFORE any parsing. The tenant is ALWAYS the one
 * resolveFormBySlug resolves from the slug — the request body is never
 * trusted for it.
 *
 * Supports both the no-JS fallback (a native form POST, url-encoded body —
 * the page's <form action/method> works with JS disabled) and the JS
 * enhancement (PublicFormView's fetch call, JSON body + `Accept:
 * application/json`) — branched on Content-Type/Accept so each gets a
 * response it can use (a redirect back to the page vs. a JSON body).
 *
 * Deliberately typed against the standard Fetch API `Request`/`Response`
 * rather than `next/server`'s `NextRequest`/`NextResponse` — this route needs
 * nothing beyond headers/text/url, and Next.js route handlers fully support
 * plain Request/Response (see api/health/route.ts for the same choice).
 */
const MAX_BODY_BYTES = 20 * 1024; // forms can have several long-answer fields
const HONEYPOT_FIELD = "company_website";

function isJsonExchange(req: Request): boolean {
  const accept = req.headers.get("accept") || "";
  const contentType = req.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

function respond(req: Request, slug: string, ok: boolean, opts: { status?: number; error?: string } = {}): Response {
  if (isJsonExchange(req)) {
    return Response.json({ ok, error: opts.error }, { status: opts.status ?? (ok ? 200 : 400) });
  }
  // No-JS fallback: bounce back to the form page with a query flag it reads.
  const url = new URL(`/f/${slug}`, req.url);
  url.search = ok ? "ok=1" : `err=${encodeURIComponent(opts.error || "Something went wrong.")}`;
  return Response.redirect(url.toString(), 303);
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const slug = params.slug;

  const rl = rateLimit(`form-submit:${clientIp(req)}`, 8, 10 * 60 * 1000);
  if (!rl.ok) {
    return respond(req, slug, false, {
      status: 429,
      error: "Too many submissions — please try again shortly.",
    });
  }

  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return respond(req, slug, false, { status: 413, error: "That submission is too large." });
  }

  const fields: Record<string, string> = {};
  try {
    if (isJsonExchange(req)) {
      const body = rawText ? JSON.parse(rawText) : {};
      if (body && typeof body === "object") {
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          fields[k] = v == null ? "" : String(v);
        }
      }
    } else {
      for (const [k, v] of new URLSearchParams(rawText).entries()) fields[k] = v;
    }
  } catch {
    return respond(req, slug, false, { status: 400, error: "Please check the form and try again." });
  }

  const resolved = resolveFormBySlug(slug);
  if (!resolved) {
    return respond(req, slug, false, { status: 404, error: "This form is no longer available." });
  }

  // Honeypot hit: silently "succeed" without storing anything — a 4xx here
  // would just teach the bot to retry differently.
  if ((fields[HONEYPOT_FIELD] || "").trim()) {
    return respond(req, slug, true);
  }

  const answers = buildAnswers(resolved.form, fields);
  const validationError = validateRequired(resolved.form, answers);
  if (validationError) {
    return respond(req, slug, false, { status: 400, error: validationError });
  }

  const formId = resolved.form.id;
  if (formId == null) {
    console.error("[f/submit] resolved form has no id — should be unreachable for a saved form", { slug });
    return respond(req, slug, false, { status: 500, error: "Something went wrong. Please try again." });
  }

  await runWithTenant(resolved.tenantId, async () => {
    insertFormSubmission(resolved.tenantId, formId, answers);
    await logActivity("form.submission", `New submission: ${resolved.form.title || "Contact form"}`, { formId });
  });

  return respond(req, slug, true);
}
