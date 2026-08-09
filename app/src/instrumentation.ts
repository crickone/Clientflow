// The daily automation scheduler + the backup/lapse schedulers are started via
// side-effect imports elsewhere (src/lib/db/index.ts, gated to production —
// see that file), which keeps better-sqlite3/the S3 client out of the
// edge/instrumentation bundle. This file is ONLY the process-level crash
// guard (Batch 1 — production safety net, improvement-plan-2026-08.md Theme
// A4). Next.js calls `register()` once per runtime when the server process
// starts, for BOTH the nodejs and edge runtimes — hence the runtime guard
// below, so nothing here ever touches the edge bundle.

// Module-level guard: `register()` is documented as a one-time call, but has
// been observed firing more than once under `next dev`'s Fast Refresh/rebuild
// cycle. Without this flag, a second call would attach a second pair of
// `process.on` listeners — not a crash risk (Node allows multiple listeners),
// just double-logged events. This buys idempotency, nothing more.
let registered = false;

// ── Crash-survived operator alert (Batch 1 fix wave, review finding #2) ────
// Logging alone is invisible unless someone is tailing Railway logs. Both
// crash handlers below ALWAYS console.error unconditionally (never
// rate-limited — that's the durable record); this adds a best-effort email
// on top so a survived crash doesn't go unnoticed for days.
//
// Rate-limit / crash-loop guard: a module-level last-alert timestamp plus a
// minimum interval, so a rejection storm (the same bug firing hundreds of
// times a second) can't send hundreds of emails. Only the EMAIL is
// throttled — console.error above always fires.
const CRASH_ALERT_MIN_INTERVAL_MS = 10 * 60_000; // 10 minutes
let lastCrashAlertMs: number | null = null;

/**
 * Pure decision helper: given the last time we actually SENT a crash-survived
 * alert email (ms epoch, or null/undefined if we never have), should we send
 * another one right now? No Date.now()/env/network access, so it's trivially
 * unit-testable (see instrumentation.test.ts) independent of the handlers,
 * timers, or mail provider.
 */
export function shouldSendAlert(
  lastAlertMs: number | null | undefined,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  if (lastAlertMs == null) return true;
  return nowMs - lastAlertMs >= minIntervalMs;
}

/**
 * Actually send the "process survived a crash" email. Split out from
 * alertOnSurvivedCrash (below) so the dynamic import + send live inside ONE
 * async try/catch: importing "@/lib/billing/emails" pulls in
 * "@/lib/db/control" (better-sqlite3 + a boot migration that touches disk),
 * which must NEVER happen at instrumentation.ts's own module-load time — only
 * lazily, here, on the rare path where a crash actually occurred. The dynamic
 * import itself sits inside this try/catch (not just the send call) because a
 * broken module graph can throw before any code in the imported module runs —
 * mirrors the identical precedent/comment in lib/backup/scheduler.ts's
 * alertBackupFailure.
 */
async function sendCrashAlertEmail(
  kind: "unhandledRejection" | "uncaughtException",
  err: Error,
  atMs: number,
): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  if (!to) return; // opt-in alarm; silent no-op when unset — never throws, never logs (the console.error above already recorded the crash itself)
  try {
    const { sendPlatformEmail } = await import("@/lib/billing/emails");
    await sendPlatformEmail(
      to,
      `[ClientFlow] Server process survived a crash (${kind})`,
      `<p>The ClientFlow server process caught a fatal <strong>${kind}</strong> at ${new Date(atMs).toISOString()} and stayed up (deliberate log-and-continue tradeoff — see the comment above the crash guards in instrumentation.ts).</p><pre>${(err.stack ?? err.message).replace(/</g, "&lt;")}</pre>`,
    );
  } catch (sendErr) {
    console.error("[fatal-guard] crash alert email itself failed to send:", sendErr);
  }
}

/**
 * Synchronous, throw-proof dispatcher called directly from the process.on
 * handlers below. A throw *inside* a process-level crash handler is
 * unrecoverable — there is no handler above it to catch it — so every branch
 * here, sync or async, must be structurally incapable of propagating an
 * exception back to the caller. `sendCrashAlertEmail` already catches
 * everything internally; the `.catch` below is a last-resort net in case a
 * future edit ever removes that, so a rejected promise here can never surface
 * as a fresh unhandledRejection (which would otherwise re-enter this exact
 * handler).
 */
function alertOnSurvivedCrash(kind: "unhandledRejection" | "uncaughtException", err: Error): void {
  try {
    const now = Date.now();
    if (!shouldSendAlert(lastCrashAlertMs, now, CRASH_ALERT_MIN_INTERVAL_MS)) return;
    lastCrashAlertMs = now; // set BEFORE the async work so a burst of crashes in the same tick can't all slip through the gate
    void sendCrashAlertEmail(kind, err, now).catch((e) => {
      console.error("[fatal-guard] crash alert dispatch rejected unexpectedly:", e);
    });
  } catch (dispatchErr) {
    console.error("[fatal-guard] crash alert dispatch failed:", dispatchErr);
  }
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (registered) return;
  registered = true;

  // ── Process-level crash guards ──────────────────────────────────────────
  // This app runs as a SINGLE persistent `next start` Node process serving
  // EVERY tenant (Railway, better-sqlite3, no per-request process isolation).
  // One bad background task — an agent's detached run IIFE, a scheduler tick,
  // any stray un-awaited promise anywhere in the app — must not be able to
  // kill the process for every other tenant.
  //
  // Node's own docs on 'uncaughtException' are explicit that resuming after
  // one is risky: "Attempting to resume normally after an uncaught exception
  // can be similar to pulling the power cord out... the correct use ... is to
  // perform synchronous cleanup of allocated resources ... and then ... shut
  // down the process" (https://nodejs.org/api/process.html#event-uncaughtexception).
  // We deliberately choose the opposite tradeoff here: for a single process
  // multiplexing many tenants, keeping the OTHER tenants online outweighs the
  // (already-a-bug) risk of leaked state in the one request/job that failed —
  // log loudly and keep serving. GET /api/health + Railway's restart policy
  // remain the backstop if the process ever gets truly wedged.
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error("[fatal-guard] unhandledRejection:", err.stack ?? err.message);
    alertOnSurvivedCrash("unhandledRejection", err);
  });

  process.on("uncaughtException", (err) => {
    console.error("[fatal-guard] uncaughtException:", err.stack ?? err.message);
    alertOnSurvivedCrash("uncaughtException", err);
  });

  console.log("[fatal-guard] process-level crash guards installed");
}
