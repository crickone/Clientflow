import "server-only";

import { runBackup, isBackupConfigured } from "./runBackup";
import { claimDailyRun, getCronState, resetDailyClaim, setCronState, shouldRunToday } from "@/lib/db/control";
import { sendPlatformEmail } from "@/lib/billing/emails";

let armed = false;
let running = false; // guards the boot-time catch-up and the 03:00 tick from ever overlapping

/** cron_state key — same shape as automations' `last_daily_run`/`billing_last_run`. */
const CRON_KEY = "backup_last_run";

/**
 * Separate cron_state key for the FAILURE EMAIL guard (Batch 1 fix wave,
 * review finding #3) — independent of CRON_KEY above, which tracks the run
 * itself and (unchanged) is only ever written on success. This key caps the
 * alert EMAIL at most once per UTC day even though a still-broken backup is
 * retried — and can re-fail — on every tick within that same day.
 */
const ALERT_CRON_KEY = "backup_last_alert";

/** UTC calendar-date string (YYYY-MM-DD) for a given ms-epoch instant. */
function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Best-effort operator email when a scheduled nightly backup fails (`ok:false`
 * or throws) — Batch 1, improvement-plan-2026-08.md A3. Reuses the existing
 * platform-level Resend sender (`sendPlatformEmail`, already used for tenant
 * provisioning/billing mail) rather than wiring a second Resend call site.
 * No-ops (logs only) when `ALERT_EMAIL` isn't set — this alarm is opt-in, never
 * a hard requirement — and never throws: a broken mail provider must not
 * affect the backup job's own control flow (mirrors every other
 * `sendPlatformEmail` call site's try/catch).
 *
 * `now` is the SAME instant the caller (runNightlyBackupIfNeeded) captured
 * before calling `runBackup()`, not a fresh `Date.now()` taken here — see the
 * review finding #4 fix below for why that matters.
 *
 * Review finding #3: capped at most once per UTC day via ALERT_CRON_KEY,
 * INDEPENDENT of the run's own retry-every-tick behaviour (CRON_KEY above is
 * untouched — the backup itself still retries every tick on failure). Without
 * this, a process that boots before 03:00 UTC with backups failing sends one
 * alert from the boot catch-up AND a second from the fixed 03:00 tick, since
 * both independently see `shouldRunToday(backup_last_run, ...) === true`
 * before either attempt has succeeded.
 */
async function alertBackupFailure(detail: string, now: number): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    console.error(
      "[backup] nightly run FAILED and ALERT_EMAIL is not set — no email sent. Set ALERT_EMAIL to be notified.",
    );
    return;
  }
  if (!shouldRunToday(getCronState(ALERT_CRON_KEY), now)) {
    console.error(
      "[backup] nightly run FAILED again today — alert email already sent once today; not re-sending (the backup itself keeps retrying every tick).",
    );
    return;
  }
  try {
    await sendPlatformEmail(
      to,
      "[ClientFlow] Nightly backup FAILED",
      `<p>The nightly database backup failed at ${new Date().toISOString()}.</p><p><strong>${detail.replace(/</g, "&lt;")}</strong></p>`,
    );
    setCronState(ALERT_CRON_KEY, utcDateString(now));
  } catch (err) {
    console.error("[backup] failure alert email itself failed to send:", err);
  }
}

/**
 * Run the nightly backup exactly once per UTC calendar day, whether triggered
 * by the boot-time catch-up or the fixed 03:00 tick (see scheduleNightlyBackup
 * below) — via the atomic claimDailyRun (Batch 6a, improvement-plan-2026-08.md
 * Theme E4; replaces the old read-then-write shouldRunToday/getCronState
 * guard so a future 2nd replica can't double-run this alongside the boot
 * catch-up). The claim is only left set after a CLEAN run (ok:true); on
 * failure it's released via resetDailyClaim — same "only done on success"
 * behaviour as Batch 1's original guard, still retryable by the next boot or
 * tick rather than being silently marked "done" for the day.
 */
async function runNightlyBackupIfNeeded(): Promise<void> {
  if (running) return;
  // Review finding #4 (midnight-straddle): captured ONCE per invocation,
  // BEFORE the `await runBackup()` below, and reused for every date-string
  // derivation in this call — including inside alertBackupFailure. Previously
  // the guard read `Date.now()` here but the success-write called a separate
  // `todayUtc()` AFTER the await; if a run straddled UTC midnight, the write
  // recorded day N+1 while the guard above had checked day N, and day N+1's
  // run was then wrongly skipped. Mirrors lib/automations/scheduler.ts's
  // `tick`, which computes its own `today` once and reuses it for both the
  // claim and the (now atomic) write.
  const now = Date.now();
  const today = utcDateString(now);
  if (!claimDailyRun(CRON_KEY, today)) return;
  running = true;
  try {
    const r = await runBackup();
    console.log("[backup] nightly:", JSON.stringify(r));
    if (r.ok) {
      // Claim already marks today done (claimDailyRun wrote it above).
    } else {
      // Preserve Batch 1's retry-on-failure: release the claim so the next
      // tick/boot (or, on a future 2nd replica, another instance) retries
      // today instead of being wrongly skipped by an already-claimed-but-
      // failed day.
      resetDailyClaim(CRON_KEY);
      await alertBackupFailure(r.error ?? "Unknown error (no detail returned)", now);
    }
  } catch (e) {
    resetDailyClaim(CRON_KEY);
    console.error("[backup] nightly failed:", e);
    await alertBackupFailure(e instanceof Error ? e.message : String(e), now);
  } finally {
    running = false;
  }
}

/**
 * Arm a nightly (03:00 UTC) backup on the always-on server process. Re-arms
 * itself after each run. Single-instance only — never call this where more than
 * one replica runs (SQLite is single-writer and we never scale > 1 anyway).
 *
 * Batch 1 additions (improvement-plan-2026-08.md Theme A1/A3/A5):
 *  - Startup alarm: shout loudly at boot if no backup target is configured.
 *  - Boot-time catch-up: a redeploy that lands after today's 03:00 UTC tick
 *    (e.g. a 3am release) used to mean waiting a FULL day for the next fixed
 *    tick before backing up again. Now it runs once, immediately, if today's
 *    UTC backup hasn't completed yet — the cron_state guard inside
 *    runNightlyBackupIfNeeded makes this safe to call alongside the fixed
 *    tick without ever running twice in the same day.
 *  - Failure email: see alertBackupFailure above.
 */
export function scheduleNightlyBackup(): void {
  if (armed) return;
  armed = true;

  if (!isBackupConfigured()) {
    console.error(
      "[backup] NOT CONFIGURED — nightly backups are OFF. Set BACKUP_S3_* (and optionally BACKUP_R2_*) env vars.",
    );
  }

  const armNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(3, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      void runNightlyBackupIfNeeded().finally(armNext);
    }, ms);
  };

  void runNightlyBackupIfNeeded(); // boot-time catch-up
  armNext();
  console.log("[backup] nightly scheduler armed (03:00 UTC + boot catch-up)");
}
