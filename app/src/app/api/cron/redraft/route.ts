import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { listTenants } from "@/lib/tenants";
import { redraftWaitingReplies } from "@/lib/inbox/redraft";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function secretMatches(provided: string | null, expected: string): boolean {
  const a = Buffer.from(provided ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Rewrite one business's waiting AI drafts so they quote today's prices
 * (lib/inbox/redraft). Runs by itself a minute after a price change; this is
 * for doing it by hand. POST with the `x-cron-secret` header and
 * `?tenant=<slug>`. Draft-only: nothing is sent to a customer.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(req.headers.get("x-cron-secret"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const slug = new URL(req.url).searchParams.get("tenant");
  const tenant = listTenants().find((t) => t.slug === slug && t.isActive !== false);
  if (!tenant) return Response.json({ ok: false, error: "Unknown business." }, { status: 404 });
  const rewritten = await redraftWaitingReplies(tenant.id);
  return Response.json({ ok: true, rewritten });
}
