import { NextResponse, type NextRequest } from "next/server";

import { runWithTenant } from "@/lib/db/tenant";
import { parseMailgunEvent, verifyMailgunSignature } from "@/lib/marketing/sender/mailgun";
import { applyEvent, resolveTenantIdForMailgunEvent } from "@/lib/marketing/events";

export const dynamic = "force-dynamic";

function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Mailgun's delivery/engagement webhook (Task 7) — the read side of the
 * campaign send pipeline (Task 5, lib/marketing/send.ts). Every
 * delivered/opened/clicked/bounced/complained/unsubscribed event Mailgun
 * fires for a campaign send lands here and is folded back into
 * campaign_sends + contact suppression + campaign stats via applyEvent
 * (see lib/marketing/events.ts).
 *
 * Public (see middleware.ts's PUBLIC_API_PREFIXES) but signature-verified
 * here — same shape as the WhatsApp bridge webhook
 * (api/whatsapp/webhook/route.ts): always 200 on a call whose signature
 * verifies (even a no-op) so Mailgun doesn't retry-storm this endpoint; 401
 * ONLY for a bad/unverifiable signature. Mailgun signs the WHOLE body
 * (`signature: {timestamp, token, signature}` alongside `event-data`), so a
 * body that isn't even valid JSON can't be verified either — that's treated
 * the same as a bad signature (401), not a silent 200.
 *
 * TENANCY: a server-to-server callback with no session cookie, so this must
 * never touch the ambient, request-scoped `db` proxy — see
 * resolveTenantIdForMailgunEvent's doc comment (lib/marketing/events.ts) for
 * how the tenant is resolved. If it can't be resolved, the event is ignored
 * (200) — NEVER a default-tenant shortcut, which would corrupt another
 * tenant's campaign_sends/suppressions.
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    // Can't even extract a signature to check — treated as unverified, not a
    // silent no-op 200 (see the doc comment above).
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sig = prop(payload, "signature");
  const timestamp = str(prop(sig, "timestamp"));
  const token = str(prop(sig, "token"));
  const signature = str(prop(sig, "signature"));
  if (!verifyMailgunSignature(timestamp, token, signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const event = parseMailgunEvent(payload);
  if (!event) {
    // Verified but not an event shape we act on (malformed, or a recognized-
    // but-uninteresting Mailgun event type) — 200 so Mailgun doesn't retry a
    // permanent no-op.
    return NextResponse.json({ ok: true, ignored: "unrecognized event" });
  }

  const tenantId = resolveTenantIdForMailgunEvent(event, payload);
  if (tenantId == null) {
    return NextResponse.json({ ok: true, ignored: "tenant unresolved" });
  }

  try {
    runWithTenant(tenantId, () => applyEvent(tenantId, event));
  } catch (err) {
    // applyEvent must never crash this webhook — this is a verified,
    // parseable call, so Mailgun must not retry it regardless.
    console.error(`[mailgun webhook] applyEvent failed (tenant ${tenantId}):`, err);
  }

  return NextResponse.json({ ok: true });
}
