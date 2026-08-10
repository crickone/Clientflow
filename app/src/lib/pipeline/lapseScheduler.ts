import "server-only";

import { recomputeLapsedAllTenants } from "./lapse";
import { claimDailyRun, resetDailyClaim } from "@/lib/db/control";

let armed = false;
let running = false; // guards the boot-time catch-up and the 04:00 tick from ever overlapping

/** cron_state key — same shape as automations' `last_daily_run`/`billing_last_run`. */
const CRON_KEY = "lapse_last_run";

/**
 * Run the lapse recompute exactly once per UTC calendar day, whether triggered
 * by the boot-time catch-up or the fixed 04:00 tick (see scheduleDailyLapse
 * below) — via the atomic claimDailyRun (Batch 6a, improvement-plan-2026-08.md
 * Theme E4; replaces the old read-then-write shouldRunToday/getCronState
 * guard so a future 2nd replica can't double-run this alongside the boot
 * catch-up). The claim is only left set after a clean run (no throw); on
 * failure it's released via resetDailyClaim, so a failed attempt stays
 * retryable rather than being silently marked "done" for the day.
 */
function runDailyLapseIfNeeded(): void {
  if (running) return;
  // Review finding #4 (midnight-straddle): captured ONCE per invocation and
  // reused for both the claim and the date derivation below, rather than
  // re-deriving the date separately at each site (which is how the sibling
  // bug in lib/backup/scheduler.ts happened — a run straddling UTC midnight
  // could record a different day than the one the guard checked, so that
  // day's run then got wrongly skipped). recomputeLapsedAllTenants() is
  // synchronous so the window is negligible here in practice, but the fix
  // mirrors lib/automations/scheduler.ts's `tick` for consistency: compute
  // `today` once, use it everywhere in this invocation.
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (!claimDailyRun(CRON_KEY, today)) return;
  running = true;
  try {
    const r = recomputeLapsedAllTenants();
    console.log("[pipeline] daily lapse:", JSON.stringify(r));
    // Claim already marks today done (claimDailyRun wrote it above).
  } catch (e) {
    // Preserve Batch 1's retry-on-failure: release the claim so the next
    // tick/boot (or, on a future 2nd replica, another instance) retries
    // today instead of being wrongly skipped by an already-claimed-but-
    // failed day.
    resetDailyClaim(CRON_KEY);
    console.error("[pipeline] daily lapse failed:", e);
  } finally {
    running = false;
  }
}

/**
 * Arm a daily (04:00 UTC) lapse recompute on the always-on server. Re-arms
 * after each run. Single-instance only (mirrors lib/backup/scheduler.ts).
 *
 * Batch 1 addition (improvement-plan-2026-08.md Theme A5): boot-time
 * catch-up. A redeploy that lands after today's 04:00 UTC tick used to mean
 * waiting a full day before the lapse stages were recomputed again. Now it
 * runs once, immediately, if today's UTC run hasn't happened yet — the
 * cron_state guard inside runDailyLapseIfNeeded makes this safe alongside the
 * fixed tick without ever running twice in the same day (same pattern as the
 * backup scheduler).
 */
export function scheduleDailyLapse(): void {
  if (armed) return;
  armed = true;

  const armNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(4, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      try {
        runDailyLapseIfNeeded();
      } finally {
        armNext();
      }
    }, ms);
  };

  runDailyLapseIfNeeded(); // boot-time catch-up
  armNext();
  console.log("[pipeline] daily lapse scheduler armed (04:00 UTC + boot catch-up)");
}
