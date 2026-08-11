import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { createTenant, provisionTenantAdmins } from "@/lib/tenants";
import { grantAdminMembership } from "@/lib/platform/access";
import { logEvent } from "@/lib/billing/engine";
import { sendPlatformEmail } from "@/lib/billing/emails";
import { listTenantSummaries } from "@/lib/platform/queries";

export const dynamic = "force-dynamic";

/** Minimal HTML escape for the small amount of user text put into the email. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** List tenants (optionally filtered by `?q=`). */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
  return NextResponse.json({ tenants: listTenantSummaries(q) });
}

const adminSchema = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
});

const schema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, hyphens"),
  venueType: z.enum(["gym", "clinic"]),
  admins: z.array(adminSchema).min(1, "At least one admin is required"),
  /** Grant the provisioning platform admin (g.userId) admin access too. */
  addMe: z.boolean().optional(),
});

/**
 * Provision a new tenant + its admins, and email each brand-new identity its
 * sign-in details. `admins` is an ordered list — the FIRST is the owner. Each
 * entry is create-or-granted: a new email gets a fresh identity + temp
 * password, an existing email just gets a membership (see
 * `provisionTenantAdmins`). If `addMe`, the calling platform admin also gets
 * an admin membership in the new tenant (idempotent).
 */
export async function POST(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const actor = `admin:${g.userId}`;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const p = parsed.data;

  // Dedupe admins case-insensitively — first occurrence wins, so the FIRST
  // admin (the owner) stays first even if its email is repeated later.
  const seen = new Set<string>();
  const admins = p.admins
    .map((a) => ({ email: a.email.trim(), name: a.name?.trim() || undefined }))
    .filter((a) => {
      const key = a.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (admins.length === 0) {
    return NextResponse.json({ error: "At least one admin is required" }, { status: 400 });
  }

  try {
    const tenant = createTenant({ slug: p.slug, name: p.name, venueType: p.venueType });
    const results = provisionTenantAdmins(tenant.id, admins);

    if (p.addMe) {
      grantAdminMembership(tenant.id, g.userId);
    }

    logEvent(
      tenant.id,
      "provisioned",
      { by: g.email, venueType: p.venueType, admins: results.length, addMe: !!p.addMe },
      actor,
    );

    const appUrl = process.env.APP_URL ?? "https://app.clientflow.ie";
    const loginUrl = `${appUrl.replace(/\/$/, "")}/login`;
    // The tenant + all admins are already committed. sendPlatformEmail's actual
    // send is try/catch-guarded, but its dynamic imports (`resend`,
    // `@/lib/email`) sit outside that guard and CAN throw — so an import/send
    // failure here must NOT report the provision as failed (that makes the
    // admin retry into "Tenant already exists"). Log it and keep going.
    // Only brand-new identities get an email — an existing identity already
    // knows how to sign in, so there's nothing to send it.
    for (const r of results) {
      if (!r.tempPassword) continue;
      try {
        await sendPlatformEmail(
          r.email,
          "Your AdonisAgent account is ready",
          `<p>Your AdonisAgent account for <strong>${esc(p.name)}</strong> is ready.</p>
           <p>Sign in at <a href="${esc(loginUrl)}">${esc(loginUrl)}</a> using:</p>
           <p><strong>Email:</strong> ${esc(r.email)}<br/>
              <strong>Temporary password:</strong> ${esc(r.tempPassword)}</p>
           <p>You'll be asked to set your own password the first time you sign in.</p>`,
        );
      } catch (err) {
        console.error("[platform] provision welcome email failed:", err);
      }
    }

    return NextResponse.json({ ok: true, tenantId: tenant.id, admins: results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to provision tenant" },
      { status: 400 },
    );
  }
}
