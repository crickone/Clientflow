import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { escapeHtml, sendPlatformEmail } from "@/lib/email";
import { getAppBaseUrl } from "@/lib/appUrl";

/**
 * Tell a business's admins that something needs them: Facebook stopped
 * accepting the connection, a scheduled post failed, a lead could not be
 * fetched. Sent from the platform's own address (works whatever email the
 * business has connected), at most once per `key` per `everyMs`, so a problem
 * the minute ticker meets every minute sends one email, not hundreds.
 *
 * Never throws: an alert that fails to send must not break the work that
 * raised it. Returns whether an email went out.
 */
export async function alertTenantAdmins(
  tenantId: number,
  key: string,
  msg: { subject: string; lines: string[]; action?: { label: string; path: string } },
  everyMs = 24 * 60 * 60 * 1000,
): Promise<boolean> {
  try {
    const now = Date.now();
    // Claim the slot first (one conditional write), so two processes or two
    // ticks racing on the same problem cannot both send.
    const claimed = controlSqlite
      .prepare(
        `INSERT INTO tenant_alerts (tenant_id, key, sent_at) VALUES (?, ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET sent_at = excluded.sent_at WHERE tenant_alerts.sent_at <= ?`,
      )
      .run(tenantId, key, now, now - everyMs).changes > 0;
    if (!claimed) return false;

    const admins = controlSqlite
      .prepare(
        `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = ? AND m.role = 'admin' AND m.is_active = 1 AND u.email IS NOT NULL`,
      )
      .all(tenantId) as Array<{ email: string }>;
    const to = [...new Set(admins.map((a) => a.email).filter(Boolean))];
    if (to.length === 0) {
      console.warn(`[alerts] tenant ${tenantId} "${key}": no admin to email`);
      return false;
    }
    const link = msg.action ? `${getAppBaseUrl()}${msg.action.path}` : null;
    const html =
      msg.lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join("") +
      (link && msg.action ? `<p style="margin:16px 0 0"><a href="${escapeHtml(link)}">${escapeHtml(msg.action.label)}</a></p>` : "");
    const res = await sendPlatformEmail({ to, subject: msg.subject, html });
    if (!res.ok) console.error(`[alerts] tenant ${tenantId} "${key}" email failed: ${res.error}`);
    else console.log(`[alerts] tenant ${tenantId} "${key}" emailed ${to.length} admin(s)`);
    return res.ok;
  } catch (err) {
    console.error(`[alerts] tenant ${tenantId} "${key}" failed:`, err);
    return false;
  }
}
