import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { controlSqlite } from "@/lib/db/control";
import { createTenant } from "@/lib/tenants";
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

const schema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, hyphens"),
  venueType: z.enum(["gym", "clinic"]),
  ownerEmail: z.string().email(),
  ownerName: z.string().max(120).optional(),
});

/** Provision a new tenant + its first admin, and email them sign-in details. */
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

  try {
    const tempPassword = crypto.randomBytes(9).toString("base64url"); // ~12 chars
    const tenant = createTenant({
      slug: p.slug,
      name: p.name,
      venueType: p.venueType,
      admin: { email: p.ownerEmail, password: tempPassword, name: p.ownerName },
    });

    // Force a first-login password change for a BRAND-NEW identity only (an
    // existing identity reused as this tenant's admin already has a password and
    // has logged in — last_login_at IS NULL narrows it to the new one).
    controlSqlite
      .prepare(
        "UPDATE users SET must_change_password = 1 WHERE email = ? AND last_login_at IS NULL",
      )
      .run(p.ownerEmail.toLowerCase());

    logEvent(tenant.id, "provisioned", { by: g.email, venueType: p.venueType }, actor);

    const appUrl = process.env.APP_URL ?? "https://app.clientflow.ie";
    const loginUrl = `${appUrl.replace(/\/$/, "")}/login`;
    // The tenant + owner are already committed. sendPlatformEmail's actual send
    // is try/catch-guarded, but its dynamic imports (`resend`, `@/lib/email`) sit
    // outside that guard and CAN throw — so an import/send failure here must NOT
    // report the provision as failed (that makes the admin retry into "Tenant
    // already exists"). Log it and still return the temp password.
    try {
      await sendPlatformEmail(
        p.ownerEmail,
        "Your ClientFlow account is ready",
        `<p>Your ClientFlow account for <strong>${esc(p.name)}</strong> is ready.</p>
         <p>Sign in at <a href="${esc(loginUrl)}">${esc(loginUrl)}</a> using:</p>
         <p><strong>Email:</strong> ${esc(p.ownerEmail)}<br/>
            <strong>Temporary password:</strong> ${esc(tempPassword)}</p>
         <p>You'll be asked to set your own password the first time you sign in.</p>`,
      );
    } catch (err) {
      console.error("[platform] provision welcome email failed:", err);
    }

    return NextResponse.json({ ok: true, tenantId: tenant.id, tempPassword });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to provision tenant" },
      { status: 400 },
    );
  }
}
