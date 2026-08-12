// Process-level crash guards (Batch 1 — production safety net,
// improvement-plan-2026-08.md Theme A4). Next.js calls `register()` once per
// runtime at server start, for BOTH nodejs and edge — so this file is compiled
// into the edge bundle too and must NOT statically or dynamically reference any
// Node-only/native module. In particular it must never reach better-sqlite3:
// the crash alert therefore hits Resend's REST API via plain `fetch` rather than
// "@/lib/billing/emails" (which pulls "@/lib/db/control" → better-sqlite3 →
// "Can't resolve 'fs'/'path'" in the edge build). A crash handler wants the
// fewest possible dependencies anyway — no DB layer, no boot migration side
// effects, just fetch + env.

// lib/env.ts is deliberately free of better-sqlite3/@aws-sdk (see its own
// doc) so this static import is safe to compile into the edge bundle too —
// logEnvCheck() itself is only ever CALLED below, inside the nodejs-only
// branch of register().
import { logEnvCheck } from "./lib/env";

// `register()` is documented as one-time but has been observed firing more than
// once under `next dev` Fast Refresh; this makes handler installation idempotent.
let registered = false;

// ── Crash-survived operator alert ────────────────────────────────────────────
// Both handlers ALWAYS console.error unconditionally (the durable record); this
// best-effort email on top means a survived crash isn't invisible. Rate-limited
// by a module-level last-sent timestamp + minimum interval so a rejection storm
// can't send hundreds of emails — only the EMAIL is throttled, never the log.
const CRASH_ALERT_MIN_INTERVAL_MS = 10 * 60_000; // 10 minutes
let lastCrashAlertMs: number | null = null;

/**
 * Pure decision helper: given the last time we actually SENT a crash-survived
 * alert (ms epoch, or null/undefined if never), should we send another now? No
 * Date.now()/env/network access, so it's trivially unit-testable
 * (instrumentation.test.ts) independent of handlers, timers, or mail provider.
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
 * Send the "process survived a crash" email via Resend's REST API directly.
 * Uses `fetch` (edge-safe, zero native deps) so this module never drags
 * better-sqlite3 into the instrumentation/edge bundle. Everything is wrapped so
 * a throw can never propagate back into the crash handler that called it.
 */
async function sendCrashAlertEmail(
  kind: "unhandledRejection" | "uncaughtException",
  err: Error,
  atMs: number,
): Promise<void> {
  const to = process.env.ALERT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return; // opt-in alarm; silent no-op when unset (console.error already recorded the crash)
  // Verified platform sender; override via ALERT_EMAIL_FROM if billing_from_email differs.
  const from = process.env.ALERT_EMAIL_FROM || "AdonisAgent Alerts <billing@adonisagent.ie>";
  const safeStack = (err.stack ?? err.message).replace(/</g, "&lt;");
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[AdonisAgent] Server process survived a crash (${kind})`,
        html: `<p>The AdonisAgent server process caught a fatal <strong>${kind}</strong> at ${new Date(atMs).toISOString()} and stayed up (deliberate log-and-continue tradeoff — see instrumentation.ts).</p><pre>${safeStack}</pre>`,
      }),
    });
  } catch (sendErr) {
    console.error("[fatal-guard] crash alert email itself failed to send:", sendErr);
  }
}

/**
 * Throw-proof dispatcher called from the process.on handlers. A throw *inside* a
 * crash handler is unrecoverable, so every branch here must be incapable of
 * propagating an exception back to the caller.
 */
function alertOnSurvivedCrash(kind: "unhandledRejection" | "uncaughtException", err: Error): void {
  try {
    const now = Date.now();
    if (!shouldSendAlert(lastCrashAlertMs, now, CRASH_ALERT_MIN_INTERVAL_MS)) return;
    lastCrashAlertMs = now; // set BEFORE the async work so a same-tick burst can't all slip through
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

  // ── Boot-time env validation (Batch 6a — improvement-plan-2026-08.md Theme
  // E5) ────────────────────────────────────────────────────────────────────
  // Loud, grouped log of missing required/recommended env vars — never
  // throws by design (see lib/env.ts's logEnvCheck doc), but wrapped anyway,
  // mirroring this file's throw-proof-handler philosophy: nothing called
  // from register() may ever turn into a boot crash-loop.
  try {
    logEnvCheck();
  } catch (err) {
    console.error("[env] startup check itself failed unexpectedly:", err);
  }

  // ── Process-level crash guards ──────────────────────────────────────────
  // This app runs as a SINGLE persistent `next start` Node process serving
  // EVERY tenant (Railway, better-sqlite3, no per-request process isolation).
  // One bad background task — an agent's detached run IIFE, a scheduler tick,
  // any stray un-awaited promise — must not kill the process for every other
  // tenant. Node's docs warn resuming after 'uncaughtException' is risky
  // (https://nodejs.org/api/process.html#event-uncaughtexception); we
  // deliberately choose the opposite tradeoff for a multi-tenant single process:
  // keeping the OTHER tenants online outweighs the (already-a-bug) risk of leaked
  // state in the one request/job that failed. GET /api/health + Railway's restart
  // policy remain the backstop if the process ever gets truly wedged.
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
