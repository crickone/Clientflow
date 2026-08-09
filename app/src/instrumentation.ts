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
  });

  process.on("uncaughtException", (err) => {
    console.error("[fatal-guard] uncaughtException:", err.stack ?? err.message);
  });

  console.log("[fatal-guard] process-level crash guards installed");
}
