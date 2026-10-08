import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";
import { generateAdIdeas } from "@/lib/ai/adIdeas";
import { listAdCreatives } from "@/lib/ads/creatives";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Ad concepts for the New ad composer. A metered AI call, so admin-gated like
 * post ideas. Returns [] rather than an error when generation can't run; the
 * operator writes their own brief.
 *
 * The avoid list is what this screen has already shown (sent by the client)
 * plus the briefs of the business's recent ads, so a shuffle moves on and a
 * concept that is already an ad is not offered again.
 */
export async function POST(req: Request) {
  const __auth = await guard("admin");
  if (__auth) return __auth;

  let count = 6;
  let shown: string[] = [];
  try {
    const body = (await req.json()) as { count?: unknown; avoid?: unknown };
    const n = Number(body?.count);
    if (Number.isInteger(n) && n > 0) count = Math.min(8, n);
    if (Array.isArray(body?.avoid)) shown = body.avoid.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 200)).slice(0, 40);
  } catch {
    // no body is fine
  }

  let made: string[] = [];
  try {
    made = listAdCreatives()
      .slice(0, 20)
      .map((a) => a.brief.offer)
      .filter(Boolean);
  } catch (err) {
    console.error("[ad-ideas] could not read recent ads:", err);
  }

  const ideas = await generateAdIdeas(getCurrentTenant().id, count, { avoid: [...shown, ...made] });
  return NextResponse.json({ ok: true, ideas });
}
