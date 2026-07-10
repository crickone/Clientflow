import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";

import { logActivity } from "@/lib/queries";
import { upsertLead } from "@/lib/leads";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Optional shared secret. When LEADS_INBOUND_TOKEN is set, callers must send it
// as the `x-webhook-token` header; until it's configured the endpoint stays open
// (so existing Zapier/Make integrations keep working) but warns in production.
const INBOUND_TOKEN = process.env.LEADS_INBOUND_TOKEN;
const MAX_BODY_BYTES = 32 * 1024; // generous for a single lead; blocks disk-fill floods
const RATE_LIMIT = 60; // requests per IP…
const RATE_WINDOW_MS = 60 * 1000; // …per minute

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Source-agnostic lead intake. Zapier / Make.com / Facebook / a manual cURL
 * — any caller posts the same normalized shape:
 *
 *   POST /api/leads/inbound
 *   Content-Type: application/json
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

  // 2. Shared-secret gate (enforced only once LEADS_INBOUND_TOKEN is configured).
  if (INBOUND_TOKEN) {
    const provided = req.headers.get("x-webhook-token") ?? "";
    if (!timingSafeEq(provided, INBOUND_TOKEN)) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn(
      "[leads/inbound] LEADS_INBOUND_TOKEN is not set — the inbound lead webhook " +
        "is unauthenticated. Set it and send it as the x-webhook-token header.",
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

  return NextResponse.json({
    ok: true,
    leadId: lead.id,
    created,
  });
}
