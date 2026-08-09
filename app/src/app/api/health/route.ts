import { controlSqlite } from "@/lib/db/control";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness/readiness probe (Batch 1 — production safety net,
 * improvement-plan-2026-08.md Theme A3). Railway (or any uptime monitor) hits
 * this directly with no session/header secret, so the response must NEVER
 * reveal anything sensitive — no tenant data, no version string, no stack
 * trace. The body is intentionally just a boolean + timestamp; failures are
 * logged server-side only.
 *
 * "Healthy" means the control DB (the tenant registry + auth store — see
 * lib/db/control.ts) answers a trivial query. Every request in the app
 * touches it sooner or later, so it's the one dependency worth probing.
 */
export async function GET() {
  try {
    controlSqlite.prepare("SELECT 1").get();
    return Response.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    console.error("[health] control DB check failed:", err);
    return Response.json({ ok: false }, { status: 503 });
  }
}
