import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { resolveChatAgent } from "@/lib/agents/chatAgent";
import { getConversation } from "@/lib/agents/conversation";
import { liveKey, subscribe } from "@/lib/agents/liveBus";
import { liveStream } from "@/lib/agents/liveStream";
import { parseStamp } from "@/lib/api/tenantStampRules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ key: string; id: string }> };

/**
 * The conversation as Adonis writes it, over Server-Sent Events: a snapshot,
 * then every word, tool and save (lib/agents/liveStream.ts). The chat opens
 * this while a run is going and polls the plain GET otherwise.
 *
 * The same checks as the conversation GET route: a session, an active
 * membership, an available agent, a sane id, and the owner's own chat
 * (getConversation looks it up by user; anyone else's id is a 404, never a
 * stream). EventSource cannot send the tenant-stamp header, so the page puts
 * the stamp in `?stamp=`, refused on mismatch like the header would be.
 */
export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  let userId: number;
  try {
    userId = (await requireUser()).id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  const stamped = parseStamp(req.nextUrl.searchParams.get("stamp"));
  if (stamped !== null && stamped !== membership.tenant.id) {
    return new Response("This tab is showing another account. Reload it.", { status: 409 });
  }
  if (!resolveChatAgent(membership.tenant.id, params.key)) return new Response("Not found", { status: 404 });
  const id = String(params.id ?? "");
  if (!id || id.length > 80) return new Response("Not found", { status: 404 });

  const ctx = { tenantId: membership.tenant.id, userId, agentKey: params.key, convId: id };
  if (!getConversation(ctx)) return new Response("Not found", { status: 404 });

  const stream = liveStream({
    subscribe: (fn) => subscribe(liveKey(ctx.tenantId, id), fn),
    snapshot: () => getConversation(ctx),
    signal: req.signal,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform also stops `next start`'s compression from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
