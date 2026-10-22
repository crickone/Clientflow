import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { resolveChatAgent } from "@/lib/agents/chatAgent";
import {
  act,
  ConversationError,
  deleteConversation,
  getConversation,
  type ConversationAction,
} from "@/lib/agents/conversation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string; id: string }> };

async function context({ params: paramsPromise }: Params) {
  const params = await paramsPromise;
  const me = await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return null;
  if (!resolveChatAgent(membership.tenant.id, params.key)) return null;
  const id = String(params.id ?? "");
  if (!id || id.length > 80) return null;
  return {
    ctx: { tenantId: membership.tenant.id, userId: me.id, agentKey: params.key, convId: id },
    admin: membership.role === "admin",
    userId: me.id,
  };
}

/** The conversation as it stands, including a reply still being written. The chat polls this. */
export async function GET(_req: NextRequest, p: Params) {
  const c = await context(p);
  if (!c) return new Response("Not found", { status: 404 });
  const conv = getConversation(c.ctx);
  if (!conv) return new Response("Not found", { status: 404 });
  return Response.json(conv);
}

export async function DELETE(_req: NextRequest, p: Params) {
  const c = await context(p);
  if (!c) return new Response("Not found", { status: 404 });
  if (!deleteConversation(c.ctx)) return Response.json({ ok: false, error: "Adonis is still working in this chat." }, { status: 409 });
  return Response.json({ ok: true });
}

/**
 * Something the operator did: send a message, approve or cancel a card, ask
 * for another draft, build the rest of a campaign, or stop. The server takes
 * it from there (lib/agents/conversation.ts) — the page can close.
 *
 * Approvals (approve, build everything, build the rest) are admin-only, the
 * same rule /api/assistant/execute enforces: they run writes.
 */
export async function POST(req: NextRequest, p: Params) {
  const c = await context(p);
  if (!c) return new Response("Not found", { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ ok: false, error: "AI is not configured." }, { status: 503 });

  const rl = rateLimit(`agent-chat:${c.userId}`, 20, 60_000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: "Too many requests — please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const index = Number(body.index);
  let action: ConversationAction | null = null;
  switch (body.type) {
    case "message":
      action = typeof body.text === "string" ? { type: "message", text: body.text.slice(0, 20000) } : null;
      break;
    case "approve":
      action = Number.isInteger(index) ? { type: "approve", index, all: body.all === true } : null;
      break;
    case "cancel":
      action = Number.isInteger(index) ? { type: "cancel", index } : null;
      break;
    case "goAgain":
      action = Number.isInteger(index) ? { type: "goAgain", index, tweak: typeof body.tweak === "string" ? body.tweak.slice(0, 2000) : "" } : null;
      break;
    case "buildRest":
      action = Number.isInteger(body.campaignId) ? { type: "buildRest", campaignId: body.campaignId as number } : null;
      break;
    case "stop":
      action = { type: "stop" };
      break;
  }
  if (!action) return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  if ((action.type === "approve" || action.type === "buildRest") && !c.admin) {
    return Response.json({ ok: false, error: "Only admins can approve and run agent actions." }, { status: 403 });
  }

  try {
    return Response.json({ ok: true, conversation: act(c.ctx, action) });
  } catch (err) {
    if (err instanceof ConversationError) return Response.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[agents/conversations]", err);
    return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
