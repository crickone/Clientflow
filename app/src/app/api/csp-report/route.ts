import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Browsers' reports for the admin app's report-only script policy
 * (middleware.ts adminScriptPolicy). Logged, one line per distinct violation
 * per hour, so the policy can be enforced once these stop appearing. Public,
 * size-capped and rate-limited; it stores nothing. Plain Request/Response.
 */
const seen = new Map<string, number>();
const HOUR = 60 * 60 * 1000;

export async function POST(req: Request) {
  if (!rateLimit(`csp-report:${clientIp(req)}`, 30, 60_000).ok) return new Response(null, { status: 204 });
  const text = (await req.text().catch(() => "")).slice(0, 8000);
  let r: Record<string, unknown> = {};
  try {
    const body = JSON.parse(text) as Record<string, unknown> | Array<{ body?: Record<string, unknown> }>;
    // Old format: {"csp-report": {...}}; Reporting API: [{type, body: {...}}].
    r = Array.isArray(body) ? body[0]?.body ?? {} : ((body["csp-report"] as Record<string, unknown>) ?? body);
  } catch {
    return new Response(null, { status: 204 });
  }
  const directive = String(r["effective-directive"] ?? r["violated-directive"] ?? r.effectiveDirective ?? "?").slice(0, 60);
  const blocked = String(r["blocked-uri"] ?? r.blockedURL ?? "?").replace(/\?.*$/, "").slice(0, 200);
  let page = String(r["document-uri"] ?? r.documentURL ?? "?");
  try {
    page = new URL(page).pathname;
  } catch {
    /* keep as is */
  }
  const key = `${directive}|${blocked}`;
  const last = seen.get(key) ?? 0;
  if (Date.now() - last > HOUR) {
    seen.set(key, Date.now());
    if (seen.size > 500) seen.clear();
    console.warn(`[csp] report-only: ${directive} would block ${blocked} on ${page.slice(0, 120)}`);
  }
  return new Response(null, { status: 204 });
}
