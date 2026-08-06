import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";

import { requirePlatformAdmin } from "@/lib/auth";
import { runBillingForDate } from "@/lib/billing/engine";
import { dublinToday } from "@/lib/billing/dates";

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
 * Run the daily platform-billing pass (renewals + dunning) across all tenants.
 * Runs automatically via the in-process scheduler; this endpoint is for testing
 * and for wiring an external cron. Auth: a signed-in platform admin, OR a
 * matching `x-cron-secret` header (set CRON_SECRET to use it for an external
 * scheduler).
 */
async function run(req: NextRequest) {
  // External scheduler: header-only secret (never a query param — those leak into
  // access logs / Referer), compared in constant time.
  const secret = process.env.CRON_SECRET;
  const bySecret = Boolean(secret) && secretMatches(req.headers.get("x-cron-secret"), secret!);
  if (!bySecret) {
    // Human fallback: must be a PLATFORM ADMIN — billing touches EVERY tenant's
    // invoices and payment state, so a plain tenant admin must not be able to
    // drive all tenants' charges.
    try {
      await requirePlatformAdmin();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  const result = await runBillingForDate(dublinToday());
  return Response.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
