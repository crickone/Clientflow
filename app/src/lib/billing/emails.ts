import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { formatCents } from "./money";
import { getPlatformSetting } from "./settings";

type Kind = "receipt" | "charge_failed" | "suspended" | "reactivated";

/**
 * Send a one-off platform email FROM AdonisAgent (via Resend) — used for
 * provisioning welcome mail, billing notices, etc. `bodyHtml` is wrapped in the
 * shared email shell (heading = subject). No-ops without a RESEND_API_KEY so
 * callers never have to guard, and so pulling this module into a test env (no
 * key) never loads the heavy `resend`/`@/lib/email` chain.
 */
export async function sendPlatformEmail(
  to: string,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const { Resend } = await import("resend");
  const { renderEmailShell } = await import("@/lib/email");

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `${getPlatformSetting("billing_from_name")} <${getPlatformSetting("billing_from_email")}>`,
      to,
      subject,
      html: renderEmailShell({
        businessName: "AdonisAgent",
        heading: subject,
        bodyHtml,
        footer: "You received this because you're the account owner on AdonisAgent.",
      }),
    });
  } catch (err) {
    console.error("[platform] email send failed:", err);
  }
}

/**
 * Email the tenant's OWNER (first admin membership) about a billing event.
 *
 * Platform sender via Resend DIRECTLY (never the gym's own Gmail): billing mail
 * must come from AdonisAgent. Heavy deps (`resend`, `@/lib/email` → gmail/oauth)
 * are imported lazily, AFTER the early return, so that pulling this module into
 * the engine (and thus into the engine's tsx test) never loads that chain — the
 * test env has no RESEND_API_KEY, so we return before any dynamic import.
 */
export async function sendBillingEmail(
  tenantId: number,
  kind: Kind,
  data: { grossCents?: number; nextAttemptAt?: string | null; periodStart?: string },
): Promise<void> {
  const owner = controlSqlite
    .prepare(
      `SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = ? AND m.role = 'admin' AND m.is_active = 1 ORDER BY m.id ASC LIMIT 1`,
    )
    .get(tenantId) as { email: string; name: string | null } | undefined;
  const apiKey = process.env.RESEND_API_KEY;
  if (!owner || !apiKey) return; // never let email failures break billing

  const { escapeHtml } = await import("@/lib/email");

  const amount = data.grossCents != null ? formatCents(data.grossCents) : "";
  const subjects: Record<Kind, string> = {
    receipt: `Receipt — AdonisAgent subscription (${amount})`,
    charge_failed: "Action needed — your AdonisAgent payment failed",
    suspended: "Your AdonisAgent subscription is paused",
    reactivated: "Your AdonisAgent subscription is active again",
  };
  const bodies: Record<Kind, string> = {
    receipt: `<p>Thanks — we've received your subscription payment of <strong>${amount}</strong>.</p><p>You can view invoices any time under Settings → Billing.</p>`,
    charge_failed: `<p>We couldn't take your AdonisAgent subscription payment${amount ? ` of <strong>${amount}</strong>` : ""}.</p><p>${
      data.nextAttemptAt ? `We'll retry on <strong>${escapeHtml(data.nextAttemptAt)}</strong>. ` : ""
    }Please check your card under Settings → Billing to avoid interruption.</p>`,
    suspended: `<p>After several failed payment attempts your AdonisAgent subscription is paused, and staff access is limited until payment is sorted.</p><p>Sign in and follow the payment screen to reactivate instantly.</p>`,
    reactivated: `<p>Payment received — your AdonisAgent subscription is active again. Welcome back!</p>`,
  };

  await sendPlatformEmail(owner.email, subjects[kind], bodies[kind]);
}
