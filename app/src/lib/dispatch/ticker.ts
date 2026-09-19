import "server-only";

import { eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { getTenantDbById, runWithTenant } from "@/lib/db/tenant";
import { tenants } from "@/lib/db/schema";
import { getAppBaseUrl } from "@/lib/appUrl";
import { dispatchDueEmailCampaigns } from "@/lib/marketing/schedule";
import { dispatchDueScheduledPosts } from "@/lib/social/schedule";
import { dispatchDueAutomationQueue } from "@/lib/automations/nurture";
import { publishDueScheduledPosts } from "@/lib/cms/blog";

/**
 * The dispatch ticker: everything that was booked for a time, sent when that
 * time comes.
 *
 *   - email campaigns with a scheduled send (lib/marketing/schedule.ts)
 *   - social posts booked for a slot (lib/social/schedule.ts)
 *   - blog posts scheduled to go live (lib/cms/blog.ts)
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
  blogsPublished: number;
  nurtureSent: number;
}

/**
 * One tenant's whole dispatch pass. Exported so a test can drive a single
 * scratch tenant: runDispatchOnce walks every active business, which in a
 * development control plane means the real ones, and that is neither fast
 * nor something a test should touch.
 */
export async function runDispatchForTenant(
  tenantId: number,
  baseUrl: string = getAppBaseUrl(),
): Promise<DispatchSummary> {
  const summary = emptySummary();
  summary.tenants = 1;
  await runTenant(tenantId, baseUrl, summary);
  return summary;
}

function emptySummary(): DispatchSummary {
  return { tenants: 0, emailsStarted: 0, postsPublished: 0, blogsPublished: 0, nurtureSent: 0 };
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
    // Scheduled blog posts. The machinery has existed since the schema
    // gained publishState "scheduled", but the only caller was the DAILY
    // scheduler, which runs once a day and not before 08:00 UTC — so a post
    // booked for 9am typically went live the following morning, because at
    // 08:00 it was not yet due and there was no later pass that day. The
    // same lateness this ticker was built to fix for emails and social.
    // Tenant-explicit db (not the request-scoped proxy) exactly as the daily
    // path does it, and idempotent, so the daily backstop remains harmless.
    try {
      summary.blogsPublished += publishDueScheduledPosts(getTenantDbById(tenantId), Date.now());
    } catch (err) {
      console.error(`[dispatch] tenant ${tenantId} scheduled blog posts failed:`, err);
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
  const summary = emptySummary();
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
  //
  // Both timers are unref'd: a pending timer otherwise keeps the Node event
  // loop alive by itself, and this module starts one the moment it is
  // imported. Under `next start` that is invisible, because the HTTP server
  // holds the process open anyway and unref'd timers still fire on schedule.
  // It matters everywhere else: a script or a test that imports anything from
  // this file would never exit, which is exactly what happened when a test
  // first reached for runDispatchForTenant.
  setTimeout(() => void tick(), 75_000).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}

if (process.env.NEXT_PHASE !== "phase-production-build") {
  startDispatchTicker();
}
