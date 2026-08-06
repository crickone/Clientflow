import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifyApiKey } from "@/lib/apiKeys";
import { runWithTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { upsertLead } from "@/lib/leads";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024; // generous for a single lead; blocks disk-fill floods
const RATE_LIMIT = 60; // requests per IP…
const RATE_WINDOW_MS = 60 * 1000; // …per minute

/**
 * Source-agnostic lead intake. Zapier / Make.com / Facebook / a manual cURL
 * — any caller posts the same normalized shape:
 *
 *   POST /api/leads/inbound
 *   Content-Type: application/json
 *   x-api-key: cf_live_…                // the caller's PER-TENANT key
 *   {
 *     "source": "zapier",            // optional, defaults to "manual"
 *     "sourceLeadId": "fb-leadgen-123", // optional, used for dedup
 *     "campaign": "HBOT - Apr 2026",
 *     "firstName": "Niamh",
 *     "lastName": "Walsh",
 *     "email": "niamh@example.com",
 *     "phone": "+353 87 …",
 *     "therapyInterest": "HBOT",
 *     "notes": "Interested in HBOT for arthritis",
 *     "raw": { ... }                  // anything you want to persist for debugging
 *   }
 *
 * The endpoint is intentionally permissive — every field except the body
 * being JSON is optional. Re-posting the same source+sourceLeadId is a no-op.
 *
 * TENANCY: the request has no session cookie, so it MUST NOT touch the
 * request-scoped `db` proxy directly (that falls back to the DEFAULT tenant —
 * the bug this endpoint used to have, writing every gym's leads into renova's
 * DB). Integrations now send their own per-tenant API key; we resolve the
 * owning tenant from it and run the upsert inside runWithTenant(tenantId, …).
 */
const schema = z.object({
  source: z.string().optional(),
  sourceLeadId: z.string().optional().nullable(),
  campaign: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  therapyInterest: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  raw: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  // 1. Throttle per IP so nobody can flood the pipeline / fill the disk.
  const rl = rateLimit(`inbound:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // 2. Per-tenant API-key gate. The key both AUTHENTICATES the caller and, by
  //    resolving to its owning tenant, ROUTES the lead into the right DB. The
  //    legacy global LEADS_INBOUND_TOKEN + default-tenant fallback is gone.
  const providedKey = req.headers.get("x-api-key") ?? "";
  const verified = verifyApiKey(providedKey);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid API key." },
      { status: 401 },
    );
  }
  const scopeList = verified.scopes.split(",").map((s) => s.trim());
  if (!scopeList.includes("leads")) {
    return NextResponse.json(
      { ok: false, error: "This API key is not scoped for leads." },
      { status: 401 },
    );
  }

  // 3. Cap the payload size before buffering it.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Payload too large." },
      { status: 413 },
    );
  }
  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Payload too large." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  // 4. Run the upsert (+ activity log) bound to the key's tenant, so every `db`
  //    access inside resolves to THAT tenant's DB — never the default.
  const result = await runWithTenant(verified.tenantId, async () => {
    const { lead, created } = upsertLead({
      source: parsed.data.source,
      sourceLeadId: parsed.data.sourceLeadId,
      campaign: parsed.data.campaign,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email || null,
      phone: parsed.data.phone,
      therapyInterest: parsed.data.therapyInterest,
      notes: parsed.data.notes,
      rawPayload: parsed.data.raw ?? body,
    });

    if (created) {
      const name =
        [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
        lead.email ||
        lead.phone ||
        "anonymous";
      await logActivity(
        "lead.new",
        `New lead via ${lead.source}: ${name}` +
          (lead.therapyInterest ? ` · ${lead.therapyInterest}` : ""),
        { leadId: lead.id },
      );
    }

    return { leadId: lead.id, created };
  });

  return NextResponse.json({
    ok: true,
    leadId: result.leadId,
    created: result.created,
  });
}
