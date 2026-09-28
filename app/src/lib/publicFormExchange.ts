/**
 * How a public form talks to a route. Two exchanges, branched on Content-Type
 * and Accept: a page's fetch (JSON in, JSON out) and a plain <form> post with
 * JavaScript off (url-encoded in, a 303 back to the page with `?ok=1` or
 * `?err=…` out, which the page reads). Shared by f/[slug]/submit and
 * api/site/enquiry so the two public forms cannot drift in how they answer.
 *
 * Plain Request/Response, not next/server, so the routes that use this load
 * in the test runner (see f/[slug]/submit/route.ts's banner for the reason).
 */
/** The one honeypot field name both public forms (f/[slug]/submit and api/site/enquiry) agree on. */
export const PUBLIC_FORM_HONEYPOT_FIELD = "company_website";

export function isJsonExchange(req: Request): boolean {
  const accept = req.headers.get("accept") || "";
  const contentType = req.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

/**
 * The submitted fields as flat strings, whichever way they arrived. Throws on
 * malformed JSON — the caller turns that into its own 400.
 */
export function parsePublicFormFields(req: Request, rawText: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (isJsonExchange(req)) {
    const body: unknown = rawText ? JSON.parse(rawText) : {};
    if (body && typeof body === "object") {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        fields[k] = v == null ? "" : String(v);
      }
    }
  } else {
    for (const [k, v] of new URLSearchParams(rawText).entries()) fields[k] = v;
  }
  return fields;
}

export interface PublicFormReply {
  status?: number;
  error?: string;
  /** Extra JSON fields for a fetch caller (a lead id, a created flag). Ignored on the redirect path. */
  extra?: Record<string, unknown>;
  /** Sent on the JSON reply only — a `Response.redirect` (the no-JS path) cannot carry extra headers. */
  headers?: HeadersInit;
}

/** JSON callers get `{ok, error, ...extra}`; a plain form post is bounced to `returnPath` with the outcome in the query. */
export function respondPublicForm(req: Request, returnPath: string, ok: boolean, opts: PublicFormReply = {}): Response {
  if (isJsonExchange(req)) {
    return Response.json(
      { ok, error: opts.error, ...(opts.extra ?? {}) },
      { status: opts.status ?? (ok ? 200 : 400), headers: opts.headers },
    );
  }
  const url = new URL(returnPath, req.url);
  url.search = ok ? "ok=1" : `err=${encodeURIComponent(opts.error || "Something went wrong.")}`;
  return Response.redirect(url.toString(), 303);
}
