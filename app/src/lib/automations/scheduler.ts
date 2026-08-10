import "server-only";

import { and, asc, eq, gte } from "drizzle-orm";

import { controlDb, getCronState, setCronState } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { automationLog, automationMessages, automationTriggers, clients, tenants } from "@/lib/db/schema";
import { applyShortcodes, DEFAULT_MESSAGES, isMessageLive, type Channel } from "@/lib/automationModel";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { listExercisesForTenant, setExerciseVideoUrlForTenant } from "@/lib/exerciseLibrary";
import { getThemeForTenant } from "@/lib/settings";
import { renderEmailShell, sendEmailForTenant, textToParagraphs } from "@/lib/email";
import { parseYouTubeId, searchExerciseVideoDetailed } from "@/lib/youtube";
import { publishDueScheduledPosts } from "@/lib/cms/blog";
import { runBillingForDate } from "@/lib/billing/engine";
import { dublinToday } from "@/lib/billing/dates";

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** MM-DD values that count as "today" for birthdays (UTC). Feb-29 births are
 *  greeted on Feb-28 in non-leap years so they don't get skipped for 3 years. */
function birthdayMonthDays(): string[] {
  const d = new Date();
  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const set = [mmdd];
  if (mmdd === "02-28" && !isLeapYear(d.getUTCFullYear())) set.push("02-29");
  return set;
}

/** Fire the birthday automation for one tenant. Tenant-explicit (no request scope). */
async function runBirthdayForTenant(tenantId: number): Promise<number> {
  const tdb = getTenantDbById(tenantId);

  const state = tdb.select().from(automationTriggers).where(eq(automationTriggers.key, "client_birthday")).get();
  if (!state?.enabled) return 0;

  const saved = tdb
    .select()
    .from(automationMessages)
    .where(eq(automationMessages.triggerKey, "client_birthday"))
    .orderBy(asc(automationMessages.position))
    .all();
  const messages: { channel: Channel; subject: string | null; template: string; delayValue: number }[] =
    saved.length > 0
      ? saved.map((m) => ({ channel: m.channel as Channel, subject: m.subject, template: m.template ?? "", delayValue: m.delayValue }))
      : (DEFAULT_MESSAGES["client_birthday"] ?? []).map((m) => ({ channel: m.channel, subject: m.subject, template: m.template, delayValue: m.delayValue }));
  const emailMessages = messages.filter((m) => isMessageLive(m) && m.template.trim());
  if (emailMessages.length === 0) return 0;

  const mmdds = birthdayMonthDays();
  const bdayClients = tdb
    .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName, email: clients.email, dob: clients.dateOfBirth })
    .from(clients)
    .all()
    .filter((c) => c.email && c.dob && c.dob.length >= 10 && mmdds.includes(c.dob.slice(5, 10)));
  if (bdayClients.length === 0) return 0;

  const businessName = getBusinessProfileForTenant(tenantId).businessName;
  const accent = getThemeForTenant(tenantId).accent;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  let sent = 0;
  for (const c of bdayClients) {
    // Per-client idempotency: skip only if we already SENT (not merely attempted)
    // a birthday email today — a failed attempt should still be retryable.
    const already = tdb
      .select({ id: automationLog.id })
      .from(automationLog)
      .where(and(eq(automationLog.triggerKey, "client_birthday"), eq(automationLog.sentTo, c.email!), eq(automationLog.status, "sent"), gte(automationLog.sentAt, todayStart)))
      .get();
    if (already) continue;

    const vars = { firstName: c.firstName, lastName: c.lastName, businessName };
    for (const m of emailMessages) {
      const subject = applyShortcodes((m.subject ?? "").trim() || `Happy birthday from ${businessName}`, vars);
      const bodyText = applyShortcodes(m.template, vars);
      const html = renderEmailShell({ businessName, accent, bodyHtml: textToParagraphs(bodyText), footer: `Sent by ${businessName}.` });
      const res = await sendEmailForTenant(tenantId, { to: c.email!, subject, html, text: bodyText });
      tdb.insert(automationLog).values({
        triggerKey: "client_birthday",
        triggerName: "Client's birthday",
        channel: "email",
        subject,
        sentTo: c.email,
        status: res.ok ? "sent" : "failed",
        sentAt: new Date(),
      }).run();
      if (res.ok) sent++;
    }
  }
  return sent;
}

/**
 * Publish any due scheduled blog posts for one tenant. Tenant-explicit (no
 * request scope), mirroring runBirthdayForTenant above: resolve the tenant's
 * own DB by id and operate on it directly — never the request-scoped `db`
 * proxy, which publishDueScheduledPosts() itself is built to avoid.
 * v1 granularity: this only runs once/day (the daily tick below), so a post
 * scheduled for e.g. 9am may not actually go live until the next tick after
 * 8am UTC that day (or the following day's tick if scheduled after that).
 * Good enough for the current use case; revisit if same-day precision matters.
 */
function runBlogScheduleForTenant(tenantId: number): number {
  const tdb = getTenantDbById(tenantId);
  return publishDueScheduledPosts(tdb, Date.now());
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Auto-fill YouTube "how-to" videos for exercises that don't have one, a batch
 * at a time. The YouTube Data API allows ~100 searches/day, so we cap per run
 * and stop early once searches start failing (quota/rate limit) — the daily
 * scheduler resumes where it left off until every exercise has a video.
 */
async function backfillVideosForTenant(tenantId: number, max: number): Promise<number> {
  if (!process.env.YOUTUBE_API_KEY) return 0;
  const missing = listExercisesForTenant(tenantId).filter((e) => !parseYouTubeId(e.videoUrl));
  if (missing.length === 0) return 0;

  let filled = 0;
  let consecutiveThrottled = 0;
  for (const ex of missing.slice(0, max)) {
    const res = await searchExerciseVideoDetailed(ex.name);

    if (res.status === "ok" && res.hit) {
      setExerciseVideoUrlForTenant(tenantId, ex.id, res.hit.url);
      filled++;
      consecutiveThrottled = 0;
    } else if (res.status === "quota") {
      break; // daily quota spent — resume tomorrow
    } else if (res.status === "rate") {
      // Sustained throttling means the key is capped for now. Bail after a few in
      // a row rather than sleeping 20s each — that made a run take 30+ minutes and
      // blow the request/gateway budget. The next daily tick resumes from here.
      if (++consecutiveThrottled >= 4) break;
    } else {
      consecutiveThrottled = 0; // "empty"/"error" for one exercise — keep going
    }
    await sleep(1200); // throttle to stay under the short-term rate limit
  }
  return filled;
}

/** Run all daily (time-based) automations across every active tenant. */
export async function runDailyAutomations(): Promise<{ tenants: number; birthdaysSent: number; videosFilled: number; postsPublished: number }> {
  const list = controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.isActive, true)).all();
  let birthdaysSent = 0;
  let videosFilled = 0;
  let postsPublished = 0;
  for (const t of list) {
    try {
      birthdaysSent += await runBirthdayForTenant(t.id);
    } catch {
      // one tenant failing must not stop the rest
    }
    try {
      videosFilled += await backfillVideosForTenant(t.id, 90);
    } catch {
      // video backfill is best-effort
    }
    try {
      const published = runBlogScheduleForTenant(t.id);
      if (published > 0) console.log(`[blog-schedule] tenant ${t.id}: published ${published} scheduled post(s)`);
      postsPublished += published;
    } catch (err) {
      console.error(`[blog-schedule] tenant ${t.id} failed (will retry next daily tick):`, err);
    }
  }

  // Platform billing: renewals + dunning. Own day-claim key, claimed AFTER a
  // clean pass (same crash-safety rule as the main claim).
  const billingKey = "billing_last_run";
  const today = dublinToday();
  if (getCronState(billingKey) !== today) {
    try {
      const summary = await runBillingForDate(today);
      setCronState(billingKey, today);
      console.log(`[billing] daily run:`, summary);
    } catch (err) {
      console.error("[billing] daily run failed (will retry on next tick):", err);
    }
  }

  return { tenants: list.length, birthdaysSent, videosFilled, postsPublished };
}

// ── In-process daily timer ────────────────────────────────────────────────────

let started = false;
let running = false;

/**
 * Start the once-a-day scheduler (self-started on server import).
 * Runs from 08:00 UTC; a persisted last-run date makes it idempotent.
 */
export function startScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    if (running) return; // don't overlap a long run (video backfill can take minutes)
    const now = new Date();
    if (now.getUTCHours() < 8) return; // send from 08:00 UTC onwards
    const today = now.toISOString().slice(0, 10);
    if (getCronState("last_daily_run") === today) return;
    running = true;
    try {
      await runDailyAutomations();
      // Mark the day done ONLY after a clean run. If the container is restarted
      // mid-run, last_daily_run stays on yesterday, so the next tick re-runs and
      // finishes the remaining tenants (all automations are idempotent).
      setCronState("last_daily_run", today);
    } catch (err) {
      console.error("[scheduler] daily run failed; will retry next tick:", err);
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), 60_000); // once shortly after boot
  setInterval(() => void tick(), 30 * 60_000); // then every 30 min
}

// Self-start on first server-side import (the root layout imports this module for
// its side effect). Skipped during the production build. `started` guards against
// duplicate timers across the many modules that touch the scheduler.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  startScheduler();
}
