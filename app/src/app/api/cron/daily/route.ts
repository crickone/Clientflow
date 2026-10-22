import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";

import { requirePlatformAdmin } from "@/lib/auth";
import { runDailyAutomations } from "@/lib/automations/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Constant-time secret comparison that doesn't leak length via early return. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Manually run the daily automations (birthdays etc.) across all tenants. Runs
 * automatically via the in-process scheduler; this endpoint is for testing and
 * for wiring an external cron. Auth: a signed-in admin, OR a matching
 * `x-cron-secret` header (set CRON_SECRET to use it for an external scheduler).
 */
async function run(req: NextRequest) {
  // External scheduler: header-only secret (never a query param — those leak into
  // access logs / Referer), compared in constant time.
  const secret = process.env.CRON_SECRET;
  const bySecret = Boolean(secret) && secretMatches(req.headers.get("x-cron-secret"), secret!);
  if (!bySecret) {
    // Human fallback: a PLATFORM admin, and only on POST. runDailyAutomations
    // touches EVERY tenant (birthday emails, scheduled posts, purges), so a
    // tenant's own admin must not drive the fleet, and a GET must not either,
    // or any page could trigger it with a link while an admin is signed in.
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    try {
      await requirePlatformAdmin();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  const result = await runDailyAutomations();
  return Response.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
