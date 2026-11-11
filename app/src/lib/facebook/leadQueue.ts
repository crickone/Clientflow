import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { runWithTenant } from "@/lib/db/tenant";
import { upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { alertTenantAdmins } from "@/lib/alerts/tenantAlerts";
import { fetchLeadAsInput, getFacebookPageByPageId } from "./pages";
import { notePageRefusal } from "./health";
import { ALERT_AFTER_ATTEMPTS, isExpired, retryDelayMs } from "./leadQueueModel";

/**
 * Lead ads that cannot be lost.
 *
 * Meta sends a leadgen notification ONCE and does not resend it. The webhook
 * used to fetch the lead on the spot and only log a failure, so a lead that
 * arrived while the Page's token was refused, Graph was having a bad minute,
 * or the Page was mid-reconnect was gone for good. Now the notification is
 * saved first (ids only, never the person's details), then fetched; a failure
 * is retried from the minute ticker (leadQueueModel.ts has the timing), the
 * business is told if it stays stuck, and after 7 days it is marked failed
 * rather than silently dropped. Fetching again is safe: upsertLead dedups on
 * source + leadgen id.
 */

interface QueueRow {
  id: number;
  leadgen_id: string;
  page_id: string;
  received_at: number;
  attempts: number;
  tenant_id: number | null;
}

/** Save a notification. A repeat of the same leadgen id is ignored. */
export function enqueueLead(leadgenId: string, pageId: string, now = Date.now()): void {
  controlSqlite
    .prepare(
      `INSERT INTO meta_lead_queue (leadgen_id, page_id, received_at, next_attempt_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(leadgen_id) DO NOTHING`,
    )
    .run(leadgenId, pageId, now, now);
}

/**
 * Try every saved notification that is due (or only `leadgenIds`, for the
 * webhook's immediate attempt). One at a time: a lead is a few Graph calls,
 * and a burst is rare. Each row is claimed by pushing its next attempt out
 * before the fetch, so the webhook and the ticker never fetch the same lead
 * twice at once. Returns how many leads were saved.
 */
export async function processDueLeads(opts: { now?: number; leadgenIds?: string[] } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  const rows = (
    opts.leadgenIds
      ? opts.leadgenIds.length
        ? (controlSqlite
            .prepare(
              `SELECT id, leadgen_id, page_id, received_at, attempts, tenant_id FROM meta_lead_queue
                WHERE status = 'pending' AND leadgen_id IN (${opts.leadgenIds.map(() => "?").join(",")})`,
            )
            .all(...opts.leadgenIds) as QueueRow[])
        : []
      : (controlSqlite
          .prepare(
            `SELECT id, leadgen_id, page_id, received_at, attempts, tenant_id FROM meta_lead_queue
              WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 50`,
          )
          .all(now) as QueueRow[])
  );

  let saved = 0;
  for (const row of rows) {
    // Claim: only the caller that moves next_attempt_at gets to fetch.
    const claimed = controlSqlite
      .prepare("UPDATE meta_lead_queue SET next_attempt_at = ? WHERE id = ? AND status = 'pending' AND attempts = ?")
      .run(now + retryDelayMs(row.attempts + 1), row.id, row.attempts).changes > 0;
    if (!claimed) continue;
    if (await processOne(row, now)) saved++;
  }
  return saved;
}

async function processOne(row: QueueRow, now: number): Promise<boolean> {
  const page = getFacebookPageByPageId(row.page_id);
  try {
    if (!page) throw new Error("The Page is not connected to any business on AdonisAgent.");
    if (!page.pageAccessToken) throw new Error("The Page needs reconnecting.");
    const input = await fetchLeadAsInput(row.leadgen_id, page.pageAccessToken);
    await runWithTenant(page.tenantId, async () => {
      const { lead, created } = upsertLead(input);
      if (created) {
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.email || lead.phone || "anonymous";
        await logActivity("lead.new", `New lead via facebook: ${name}`, { leadId: lead.id });
      }
    });
    controlSqlite
      .prepare("UPDATE meta_lead_queue SET status = 'done', done_at = ?, tenant_id = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?")
      .run(Date.now(), page.tenantId, row.id);
    if (row.attempts > 0) console.log(`[meta leads] lead ${row.leadgen_id} saved on try ${row.attempts + 1}`);
    return true;
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const attempts = row.attempts + 1;
    const tenantId = page?.tenantId ?? row.tenant_id;
    if (page) await notePageRefusal(row.page_id, err).catch(() => false);
    const expired = isExpired(row.received_at, now);
    controlSqlite
      .prepare("UPDATE meta_lead_queue SET attempts = ?, last_error = ?, tenant_id = ?, status = ? WHERE id = ?")
      .run(attempts, reason, tenantId, expired ? "failed" : "pending", row.id);
    console.error(`[meta leads] lead ${row.leadgen_id} (Page ${row.page_id}) try ${attempts} failed: ${reason}${expired ? "; giving up" : ""}`);

    if (tenantId && (attempts === ALERT_AFTER_ATTEMPTS || expired)) {
      await alertTenantAdmins(
        tenantId,
        expired ? `fb-lead-failed:${row.leadgen_id}` : "fb-leads-waiting",
        expired
          ? {
              subject: "A Facebook lead could not be saved",
              lines: [
                "A lead from your Facebook lead ads could not be fetched from Facebook for 7 days, so AdonisAgent has stopped trying.",
                `Facebook's last reason: ${reason}`,
                "You can still download it from Meta Business Suite (Leads Center) for up to 90 days after it was submitted.",
              ],
              action: { label: "Open Facebook settings", path: "/settings/integrations/facebook" },
            }
          : {
              subject: "Facebook leads are waiting to come in",
              lines: [
                "AdonisAgent has received a lead from your Facebook lead ads but cannot fetch it from Facebook yet. It is kept and tried again automatically.",
                `Facebook's reason: ${reason}`,
                "If your Facebook connection needs reconnecting, do that and the waiting leads come in within a few minutes.",
              ],
              action: { label: "Open Facebook settings", path: "/settings/integrations/facebook" },
            },
        expired ? 365 * 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000,
      );
    }
    return false;
  }
}

/** Leads waiting or given up on for a business, for the dashboard. */
export function stuckLeadCounts(tenantId: number): { waiting: number; failed: number } {
  const row = controlSqlite
    .prepare(
      `SELECT SUM(CASE WHEN status = 'pending' AND attempts > 0 THEN 1 ELSE 0 END) AS waiting,
              SUM(CASE WHEN status = 'failed' AND received_at > ? THEN 1 ELSE 0 END) AS failed
         FROM meta_lead_queue WHERE tenant_id = ?`,
    )
    .get(Date.now() - 30 * 24 * 60 * 60 * 1000, tenantId) as { waiting: number | null; failed: number | null };
  return { waiting: row.waiting ?? 0, failed: row.failed ?? 0 };
}

/** Pending leads for a Page are retried at once, e.g. right after it reconnects. */
export function retryLeadsForPageNow(pageId: string): void {
  controlSqlite.prepare("UPDATE meta_lead_queue SET next_attempt_at = ? WHERE page_id = ? AND status = 'pending'").run(Date.now(), pageId);
}
