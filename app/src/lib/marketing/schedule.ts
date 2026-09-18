import "server-only";

import { and, asc, eq, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { getTenantDbById } from "@/lib/db/tenant";
import { emailCampaigns } from "@/lib/db/schema";
import { logActivity } from "@/lib/queries";
import { markCampaignSending, precheckCampaign, runCampaignSend } from "./send";
import { toRecord, type CampaignRecord } from "./campaigns";

/**
 * Email campaigns sent LATER, at a time the operator approved.
 *
 * `email_campaigns.scheduled_at` had existed for a while with nothing writing
 * or reading it, and launch_campaign was honest that a kit's three emails
 * could only be sent by hand, all at once. This is the send-later half:
 *
 *   schedule   draft  -> scheduled  (with the time)
 *   unschedule scheduled -> draft   (time cleared)
 *   dispatch   scheduled & due -> the SAME precheck + send the Send button
 *              runs (send.ts), one campaign at a time, inside the ticker.
 *
 * A due campaign that fails its precheck (no verified domain, no credits, an
 * empty audience) goes BACK to draft with the reason recorded on its stats,
 * rather than to "failed": the operator fixes the cause and schedules it
 * again, and the campaign page can show them why it did not go.
 */

export type ScheduleResult = { ok: true; campaign: CampaignRecord } | { ok: false; error: string };

/** The earliest a send may be booked for: a minute out, so "now" is not a schedule. */
const MIN_LEAD_MS = 60_000;

export function scheduleEmailCampaign(campaignId: number, sendAt: Date): ScheduleResult {
  const row = db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).get();
  if (!row) return { ok: false, error: "Campaign not found." };
  if (row.status !== "draft" && row.status !== "scheduled") {
    return { ok: false, error: `This campaign is already "${row.status}" and cannot be scheduled.` };
  }
  if (!Number.isFinite(sendAt.getTime())) return { ok: false, error: "That is not a valid date and time." };
  if (sendAt.getTime() < Date.now() + MIN_LEAD_MS) {
    return { ok: false, error: "Pick a time in the future." };
  }
  db.update(emailCampaigns)
    .set({ status: "scheduled", scheduledAt: sendAt })
    .where(eq(emailCampaigns.id, campaignId))
    .run();
  return { ok: true, campaign: toRecord(db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).get()!) };
}

export function unscheduleEmailCampaign(campaignId: number): ScheduleResult {
  const row = db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).get();
  if (!row) return { ok: false, error: "Campaign not found." };
  if (row.status !== "scheduled") return { ok: false, error: `This campaign is "${row.status}", not scheduled.` };
  db.update(emailCampaigns)
    .set({ status: "draft", scheduledAt: null })
    .where(eq(emailCampaigns.id, campaignId))
    .run();
  return { ok: true, campaign: toRecord(db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).get()!) };
}

export function listScheduledEmailCampaigns(): CampaignRecord[] {
  return db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.status, "scheduled"))
    .orderBy(asc(emailCampaigns.scheduledAt))
    .all()
    .map(toRecord);
}

/** What the last scheduled attempt said, if it went back to draft. */
export function lastScheduleError(campaign: CampaignRecord): string | null {
  const err = campaign.stats?.lastScheduleError;
  return typeof err === "string" && err.trim() ? err : null;
}

/**
 * Send every due campaign for one tenant. Runs inside runWithTenant(tenantId)
 * (the ticker guarantees it) because runCampaignSend's own helpers read the
 * ambient tenant. Sequential on purpose: two campaigns sending at once would
 * double the batch rate the send engine paces itself to.
 */
export async function dispatchDueEmailCampaigns(tenantId: number, baseUrl: string, now: number = Date.now()): Promise<number> {
  const tdb = getTenantDbById(tenantId);
  const due = tdb
    .select({ id: emailCampaigns.id, name: emailCampaigns.name, stats: emailCampaigns.stats })
    .from(emailCampaigns)
    .where(and(eq(emailCampaigns.status, "scheduled"), lte(emailCampaigns.scheduledAt, new Date(now))))
    .orderBy(asc(emailCampaigns.scheduledAt))
    .all();
  let started = 0;

  for (const c of due) {
    // precheckCampaign insists on "draft" -- the status the Send button sees.
    tdb.update(emailCampaigns).set({ status: "draft" }).where(eq(emailCampaigns.id, c.id)).run();
    const pre = await precheckCampaign(tenantId, c.id, baseUrl);
    if (!pre.ok) {
      const stats = parseStats(c.stats);
      stats.lastScheduleError = pre.error;
      stats.lastScheduleAttemptAt = now;
      tdb.update(emailCampaigns)
        .set({ status: "draft", scheduledAt: null, stats: JSON.stringify(stats) })
        .where(eq(emailCampaigns.id, c.id))
        .run();
      console.error(`[email-schedule] tenant ${tenantId} campaign #${c.id} "${c.name}" not sent: ${pre.error}`);
      try {
        await logActivity("campaigns.send", `Scheduled send of "${c.name}" did not go: ${pre.error}`);
      } catch {
        // The activity line is a courtesy.
      }
      continue;
    }
    const marked = markCampaignSending(tenantId, c.id);
    if (!marked.ok) {
      console.error(`[email-schedule] tenant ${tenantId} campaign #${c.id}: ${marked.error}`);
      continue;
    }
    try {
      await logActivity("campaigns.send", `Scheduled send of "${c.name}" started to ${pre.recipients} recipient(s)`);
    } catch {
      // See above.
    }
    await runCampaignSend(tenantId, c.id, baseUrl);
    started++;
  }
  return started;
}

function parseStats(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
