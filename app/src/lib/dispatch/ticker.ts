import "server-only";

import { eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { runWithTenant } from "@/lib/db/tenant";
import { tenants } from "@/lib/db/schema";
import { getAppBaseUrl } from "@/lib/appUrl";
import { dispatchDueEmailCampaigns } from "@/lib/marketing/schedule";
import { dispatchDueScheduledPosts } from "@/lib/social/schedule";
import { dispatchDueAutomationQueue } from "@/lib/automations/nurture";

/**
 * The dispatch ticker: everything that was booked for a time, sent when that
 * time comes.
 *
 *   - email campaigns with a scheduled send (lib/marketing/schedule.ts)
 *   - social posts booked for a slot (lib/social/schedule.ts)
 *   - the campaign nurture sequence's delayed messages (lib/automations/nurture.ts)
 *
 * A minute-granularity loop of its own, like the voice dialler and unlike
 * the daily scheduler: a post booked for 9:00 that goes at 9:30 is late in a
 * way an operator notices. One process runs every tenant (Railway keeps
 * this app up as one `next start`), so the loop walks the active tenants
 * and enters each one's scope before touching its data -- the same shape as
 * lib/voice/runner.ts, and self-started the same way from the root layout.
 *
 * Boring by construction: one tenant at a time, one tick at a time (a slow
 * tick simply delays the next), every tenant's failure caught so it cannot
 * take the others down with it.
 */
let started = false;
let running = false;
const TICK_MS = 60_000;

export interface DispatchSummary {
  tenants: number;
  emailsStarted: number;
  postsPublished: number;
  nurtureSent: number;
}

async function runTenant(tenantId: number, baseUrl: string, summary: DispatchSummary): Promise<void> {
  await runWithTenant(tenantId, async () => {
    try {
      summary.emailsStarted += await dispatchDueEmailCampaigns(tenantId, baseUrl);
    } catch (err) {
      console.error(`[dispatch] tenant ${tenantId} email campaigns failed:`, err);
    }
    try {
      summary.postsPublished += await dispatchDueScheduledPosts(tenantId, baseUrl);
    } catch (err) {
      console.error(`[dispatch] tenant ${tenantId} scheduled posts failed:`, err);
    }
    try {
      summary.nurtureSent += await dispatchDueAutomationQueue(tenantId);
    } catch (err) {
      console.error(`[dispatch] tenant ${tenantId} nurture queue failed:`, err);
    }
  });
}

/** One pass over every active tenant. Exported so a cron route or a test can drive it. */
export async function runDispatchOnce(): Promise<DispatchSummary> {
  const summary: DispatchSummary = { tenants: 0, emailsStarted: 0, postsPublished: 0, nurtureSent: 0 };
  const baseUrl = getAppBaseUrl();
  const active = controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.isActive, true)).all();
  for (const t of active) {
    summary.tenants++;
    try {
      await runTenant(t.id, baseUrl, summary);
    } catch (err) {
      console.error(`[dispatch] tenant ${t.id} failed (retrying next tick):`, err);
    }
  }
  return summary;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runDispatchOnce();
  } catch (err) {
    console.error("[dispatch] tick failed:", err);
  } finally {
    running = false;
  }
}

export function startDispatchTicker(): void {
  if (started) return;
  started = true;
  // A short delay after boot so the DBs are open and migrations have run,
  // then every minute.
  setTimeout(() => void tick(), 75_000);
  setInterval(() => void tick(), TICK_MS);
}

if (process.env.NEXT_PHASE !== "phase-production-build") {
  startDispatchTicker();
}
