import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

import { getCurrentTenant } from "@/lib/db/tenant";
import { generatePostIdeas } from "@/lib/ai/image/postIdeas";
import { hooksToAvoid, recordSuggested } from "@/lib/content-studio/ideaLibrary";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * In-depth post ideas across the account's content pillars. A metered AI call,
 * so it's admin-gated like the other paid surfaces. Returns [] rather than an
 * error when generation can't run (over cap, key missing) — the caller just
 * shows nothing and the operator types their own topic.
 *
 * Every run reads what this tenant has already been shown and hands it to the
 * generator as an avoid list, then records what came back. Without that round
 * trip the generator has no memory between runs and "New ideas" returns the
 * same angles over and over — see @/lib/ai/image/postIdeas.
 *
 * Recording is best-effort: a failure to write the ledger must not cost the
 * operator the ideas that are already sitting in hand.
 */
export async function POST(req: Request) {
  const __auth = await guard("admin");
  if (__auth) return __auth;

  let count = 6;
  try {
    const body = (await req.json()) as { count?: unknown };
    const n = Number(body?.count);
    if (Number.isInteger(n) && n > 0) count = Math.min(10, n);
  } catch {
    // no body is fine — use the default
  }

  const tenantId = getCurrentTenant().id;
  const ideas = await generatePostIdeas(tenantId, count, { avoid: hooksToAvoid() });
  try {
    recordSuggested(ideas.map((i) => i.hook));
  } catch (err) {
    console.error("[post-ideas] could not record suggested hooks:", err);
  }
  return NextResponse.json({ ok: true, ideas });
}
