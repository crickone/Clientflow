import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { executeTool, isWriteTool, type ToolArtifact } from "@/lib/assistant/tools";
import { runWithTenant } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Action = { name: string; input: Record<string, unknown> };

/**
 * Executes assistant WRITE actions — but ONLY after the user clicked Approve in
 * the chat UI. The chat route never runs write tools; it proposes them and the
 * client posts them here on approval. This is the enforcement point for the
 * prompt-injection guard: writes can't happen without an explicit operator click.
 */
export async function POST(req: NextRequest) {
  const me = await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  const tenantId = membership.tenant.id;
  const userId = me.id;

  // C4b (burst ceiling — improvement-plan-2026-08.md Theme C4/C4b): see the
  // identical comment in /api/agents/[key]/chat — same reasoning, its own
  // bucket (per-user, per-route). Writes only run after an explicit operator
  // Approve click, so normal use is a handful of these per minute at most.
  const rl = rateLimit(`assistant-execute:${userId}`, 20, 60_000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: "Too many requests — please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { actions?: Action[] };
  const actions = Array.isArray(body.actions) ? body.actions.slice(0, 20) : [];
  if (actions.length === 0) return Response.json({ ok: false, error: "No actions." }, { status: 400 });

  // Reject anything that isn't a known write tool — a read tool or unknown name
  // has no business going through the approval channel.
  for (const a of actions) {
    if (!a || typeof a.name !== "string" || !isWriteTool(a.name)) {
      return Response.json({ ok: false, error: "Unsupported action." }, { status: 400 });
    }
  }

  const results: { name: string; ok: boolean; text: string; artifact?: ToolArtifact }[] = [];
  await runWithTenant(tenantId, async () => {
    for (const a of actions) {
      try {
        const r = await executeTool(a.name, (a.input ?? {}) as Record<string, unknown>, { tenantId, userId });
        results.push({ name: a.name, ok: true, text: r.text, artifact: r.artifact });
      } catch (err) {
        results.push({ name: a.name, ok: false, text: err instanceof Error ? err.message : "Action failed." });
      }
    }
  });

  return Response.json({ ok: true, results });
}
