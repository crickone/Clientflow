import crypto from "node:crypto";

/**
 * Pure helpers for the Facebook `leadgen` webhook — deliberately NO
 * `import "server-only"` and no env/DB reads (the app secret is passed IN), so
 * they import cleanly under the plain-tsx test runner (same reasoning as
 * humanName.ts). The route (api/integrations/facebook/leadgen) reads process.env
 * and does the network/DB I/O; these just verify + parse.
 */

/**
 * Verify a Facebook webhook's `X-Hub-Signature-256` header — value is
 * `sha256=<hex>`, hex = HMAC-SHA256(appSecret, rawBody). Constant-time compare;
 * fails CLOSED when the secret or header is missing (an unconfigured deploy can
 * never accept a forged leadgen event). Mirrors verifyMailgunSignature's
 * length-check + timingSafeEqual tail (timingSafeEqual throws on a length
 * mismatch, so length is checked first).
 */
export function verifyFacebookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface LeadgenChange {
  leadgenId: string;
  pageId: string;
  formId?: string;
  createdTime?: number;
}

/**
 * Parse Facebook's leadgen webhook body into the changes we act on. Shape:
 * `{ object:"page", entry:[{ id, time, changes:[{ field:"leadgen",
 * value:{ leadgen_id, page_id, form_id, created_time } }] }] }`. Skips any
 * non-leadgen change and anything missing a leadgen_id or page_id. Never throws
 * — a malformed body yields an empty list (the route then 200s, no retry-storm).
 */
export function parseLeadgenEvents(payload: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const entries = prop(payload, "entry");
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = prop(entry, "changes");
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (prop(change, "field") !== "leadgen") continue;
      const v = prop(change, "value");
      const leadgenId = str(prop(v, "leadgen_id"));
      const pageId = str(prop(v, "page_id"));
      if (!leadgenId || !pageId) continue;
      out.push({
        leadgenId,
        pageId,
        formId: str(prop(v, "form_id")) || undefined,
        createdTime: toFiniteNumber(prop(v, "created_time")) ?? undefined,
      });
    }
  }
  return out;
}

// ── tiny unknown-payload guards (mirror mailgun.ts / whapi.ts) ──
function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
