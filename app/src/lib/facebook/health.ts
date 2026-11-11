import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { alertTenantAdmins } from "@/lib/alerts/tenantAlerts";
import { isConnectionRefused } from "./graph";

/**
 * Whether Facebook still accepts a business's connection.
 *
 * Meta stops accepting a token when someone removes the app, changes their
 * Facebook password, loses admin on the Page, or a permission is withdrawn.
 * Nothing on our side changes when that happens, so before this, posts failed
 * one by one, replies failed, and lead ads could not be fetched, with nothing
 * on screen. Now any Graph call that meets such a refusal marks the Page (or
 * the ads grant): Settings and the dashboard say "reconnect", the admins get
 * one email, and a reconnect clears it (claimPage / saveGrant).
 */

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Record Meta's refusal for a Page, if `err` is one. Returns whether it was.
 * Only a live Page is marked, and only the first refusal sets the time, so
 * Settings shows when it started.
 */
export async function notePageRefusal(pageId: string, err: unknown): Promise<boolean> {
  if (!isConnectionRefused(err)) return false;
  const row = controlSqlite
    .prepare("SELECT tenant_id, page_name, needs_reconnect_at FROM facebook_pages WHERE page_id = ? AND revoked_at IS NULL")
    .get(pageId) as { tenant_id: number; page_name: string | null; needs_reconnect_at: number | null } | undefined;
  if (!row) return true;
  if (row.needs_reconnect_at == null) {
    controlSqlite
      .prepare("UPDATE facebook_pages SET needs_reconnect_at = ?, needs_reconnect_reason = ? WHERE page_id = ? AND revoked_at IS NULL AND needs_reconnect_at IS NULL")
      .run(Date.now(), reasonOf(err), pageId);
    console.warn(`[facebook] Page ${pageId} (tenant ${row.tenant_id}) refused by Meta; marked for reconnect`);
  }
  const name = row.page_name ?? "your Facebook Page";
  await alertTenantAdmins(row.tenant_id, `fb-page-refused:${pageId}`, {
    subject: `Reconnect Facebook: ${name} stopped working`,
    lines: [
      `Facebook stopped accepting AdonisAgent's connection to ${name}. Until you reconnect, scheduled posts to it fail, replies to its messages cannot be sent, and its lead ads wait.`,
      `Facebook's reason: ${reasonOf(err)}`,
      "Leads that arrive in the meantime are kept and fetched once you reconnect.",
    ],
    action: { label: "Reconnect Facebook", path: "/settings/integrations/facebook" },
  });
  return true;
}

/** The same for the ads connection (the business's grant token). */
export async function noteGrantRefusal(tenantId: number, err: unknown): Promise<boolean> {
  if (!isConnectionRefused(err)) return false;
  const res = controlSqlite
    .prepare("UPDATE meta_grants SET needs_reconnect_at = ?, needs_reconnect_reason = ? WHERE tenant_id = ? AND needs_reconnect_at IS NULL")
    .run(Date.now(), reasonOf(err), tenantId);
  if (res.changes > 0) console.warn(`[facebook] tenant ${tenantId} ads connection refused by Meta; marked for reconnect`);
  await alertTenantAdmins(tenantId, "fb-grant-refused", {
    subject: "Reconnect Facebook: ads stopped working",
    lines: [
      "Facebook stopped accepting AdonisAgent's connection to your ad account. Ads cannot be launched or changed from AdonisAgent until you reconnect.",
      `Facebook's reason: ${reasonOf(err)}`,
    ],
    action: { label: "Reconnect Facebook", path: "/settings/integrations/facebook" },
  });
  return true;
}

export interface ConnectionProblem {
  kind: "page" | "ads";
  name: string;
  since: number;
  reason: string | null;
}

/** What needs a reconnect for this business, for Settings and the dashboard. */
export function connectionProblems(tenantId: number): ConnectionProblem[] {
  const pages = controlSqlite
    .prepare(
      "SELECT page_name, needs_reconnect_at, needs_reconnect_reason FROM facebook_pages WHERE tenant_id = ? AND revoked_at IS NULL AND needs_reconnect_at IS NOT NULL",
    )
    .all(tenantId) as Array<{ page_name: string | null; needs_reconnect_at: number; needs_reconnect_reason: string | null }>;
  const grant = controlSqlite
    .prepare("SELECT needs_reconnect_at, needs_reconnect_reason FROM meta_grants WHERE tenant_id = ? AND needs_reconnect_at IS NOT NULL")
    .get(tenantId) as { needs_reconnect_at: number; needs_reconnect_reason: string | null } | undefined;
  return [
    ...pages.map((p) => ({ kind: "page" as const, name: p.page_name ?? "Facebook Page", since: p.needs_reconnect_at, reason: p.needs_reconnect_reason })),
    ...(grant ? [{ kind: "ads" as const, name: "Ad account", since: grant.needs_reconnect_at, reason: grant.needs_reconnect_reason }] : []),
  ];
}
