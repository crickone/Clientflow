import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { rateLimit, clientIp } from "@/lib/rateLimit";
import { getTenantBySlug } from "@/lib/tenants";
import { runWithTenant } from "@/lib/db/tenant";
import { upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Public lead capture for the clientflow.ie marketing site's "Book a demo" form.
 * Unlike the per-tenant `/api/leads/inbound` webhook (which is keyed), this is a
 * single-purpose endpoint hard-bound to the ClientFlow tenant server-side — so
 * NO API key is ever exposed in the browser. Rate-limited by IP. Demo requests
 * land as leads in ClientFlow's own CRM (we run on ClientFlow, too).
 */
const CLIENTFLOW_SLUG = "clientflow";
const MAX_BODY_BYTES = 8 * 1024;

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  business: z.string().trim().max(160).optional().default(""),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(60).optional().default(""),
  currentSoftware: z.string().trim().max(120).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  // Honeypot: real users never fill this. Bots do. Accepted by the schema so a
  // filled value is handled silently below (a 400 here would tip the bot off).
  company_website: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const rl = rateLimit(`site-demo:${clientIp(req)}`, 5, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests — please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." },
      { status: 400 },
    );
  }
  // Silently accept honeypot hits (don't tip off bots) without creating a lead.
  if (parsed.data.company_website) return NextResponse.json({ ok: true });

  const tenant = getTenantBySlug(CLIENTFLOW_SLUG);
  if (!tenant) {
    console.error("[site-demo-lead] clientflow tenant not found");
    return NextResponse.json({ ok: false, error: "Something went wrong. Please email us instead." }, { status: 500 });
  }

  const d = parsed.data;
  const [firstName, ...rest] = d.name.split(/\s+/);
  const lastName = rest.join(" ") || undefined;
  const notes = [
    d.business ? `Business: ${d.business}` : null,
    d.currentSoftware ? `Currently using: ${d.currentSoftware}` : null,
    d.message ? `Message: ${d.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await runWithTenant(tenant.id, async () => {
    const { lead, created } = upsertLead({
      source: "website-demo",
      campaign: "clientflow.ie",
      firstName,
      lastName,
      email: d.email,
      phone: d.phone || undefined,
      notes: notes || undefined,
      rawPayload: body,
    });
    if (created) {
      await logActivity("lead.new", `Demo request via clientflow.ie: ${d.name}${d.business ? ` (${d.business})` : ""}`, {
        leadId: lead.id,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
