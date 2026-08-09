import "server-only";

import { runBackup, isBackupConfigured } from "./runBackup";
import { getCronState, setCronState, shouldRunToday } from "@/lib/db/control";
import { sendPlatformEmail } from "@/lib/billing/emails";

let armed = false;
let running = false; // guards the boot-time catch-up and the 03:00 tick from ever overlapping

/** cron_state key — same shape as automations' `last_daily_run`/`billing_last_run`. */
const CRON_KEY = "backup_last_run";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
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
 */
async function alertBackupFailure(detail: string): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    console.error(
      "[backup] nightly run FAILED and ALERT_EMAIL is not set — no email sent. Set ALERT_EMAIL to be notified.",
    );
    return;
  }
  try {
    await sendPlatformEmail(
      to,
      "[ClientFlow] Nightly backup FAILED",
      `<p>The nightly database backup failed at ${new Date().toISOString()}.</p><p><strong>${detail.replace(/</g, "&lt;")}</strong></p>`,
    );
  } catch (err) {
    console.error("[backup] failure alert email itself failed to send:", err);
  }
}

/**
 * Run the nightly backup exactly once per UTC calendar day, whether triggered
 * by the boot-time catch-up or the fixed 03:00 tick (see scheduleNightlyBackup
 * below) — mirrors the cron_state date-guard pattern in
 * lib/automations/scheduler.ts. `cron_state` is only written on a CLEAN run
 * (ok:true), same as that module's `last_daily_run`/`billing_last_run`: a
 * failed attempt stays retryable by the next boot or tick rather than being
 * silently marked "done" for the day.
 */
async function runNightlyBackupIfNeeded(): Promise<void> {
  if (running) return;
  if (!shouldRunToday(getCronState(CRON_KEY), Date.now())) return;
  running = true;
  try {
    const r = await runBackup();
    console.log("[backup] nightly:", JSON.stringify(r));
    if (r.ok) {
      setCronState(CRON_KEY, todayUtc());
    } else {
      await alertBackupFailure(r.error ?? "Unknown error (no detail returned)");
    }
  } catch (e) {
    console.error("[backup] nightly failed:", e);
    await alertBackupFailure(e instanceof Error ? e.message : String(e));
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
