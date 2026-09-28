import { clientIp, rateLimit } from "@/lib/rateLimit";
import { runWithTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { buildAnswers, insertFormSubmission, resolveFormBySlug, validateRequired } from "@/lib/publicForms";
import { PUBLIC_FORM_HONEYPOT_FIELD, parsePublicFormFields, respondPublicForm } from "@/lib/publicFormExchange";

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
 * response it can use (a redirect back to the page vs. a JSON body). That
 * exchange lives in lib/publicFormExchange.ts, shared with api/site/enquiry.
 *
 * Deliberately typed against the standard Fetch API `Request`/`Response`
 * rather than `next/server`'s `NextRequest`/`NextResponse` — this route needs
 * nothing beyond headers/text/url, and Next.js route handlers fully support
 * plain Request/Response (see api/health/route.ts for the same choice).
 */
const MAX_BODY_BYTES = 20 * 1024; // forms can have several long-answer fields

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const slug = params.slug;

  const rl = rateLimit(`form-submit:${clientIp(req)}`, 8, 10 * 60 * 1000);
  if (!rl.ok) {
    return respondPublicForm(req, `/f/${slug}`, false, {
      status: 429,
      error: "Too many submissions — please try again shortly.",
    });
  }

  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return respondPublicForm(req, `/f/${slug}`, false, { status: 413, error: "That submission is too large." });
  }

  let fields: Record<string, string>;
  try {
    fields = parsePublicFormFields(req, rawText);
  } catch {
    return respondPublicForm(req, `/f/${slug}`, false, { status: 400, error: "Please check the form and try again." });
  }

  const resolved = resolveFormBySlug(slug);
  if (!resolved) {
    return respondPublicForm(req, `/f/${slug}`, false, { status: 404, error: "This form is no longer available." });
  }

  // Honeypot hit: silently "succeed" without storing anything — a 4xx here
  // would just teach the bot to retry differently.
  if ((fields[PUBLIC_FORM_HONEYPOT_FIELD] || "").trim()) {
    return respondPublicForm(req, `/f/${slug}`, true);
  }

  const answers = buildAnswers(resolved.form, fields);
  const validationError = validateRequired(resolved.form, answers);
  if (validationError) {
    return respondPublicForm(req, `/f/${slug}`, false, { status: 400, error: validationError });
  }

  const formId = resolved.form.id;
  if (formId == null) {
    console.error("[f/submit] resolved form has no id — should be unreachable for a saved form", { slug });
    return respondPublicForm(req, `/f/${slug}`, false, { status: 500, error: "Something went wrong. Please try again." });
  }

  await runWithTenant(resolved.tenantId, async () => {
    insertFormSubmission(resolved.tenantId, formId, answers);
    await logActivity("form.submission", `New submission: ${resolved.form.title || "Contact form"}`, { formId });
  });

  return respondPublicForm(req, `/f/${slug}`, true);
}
