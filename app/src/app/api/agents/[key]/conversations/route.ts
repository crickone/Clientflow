import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { resolveChatAgent } from "@/lib/agents/chatAgent";
import { importConversations, listConversations } from "@/lib/agents/conversation";

export const dynamic = "force-dynamic";

/** This user's conversations with the agent, newest first (lib/agents/conversation.ts). */
export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const me = await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  if (!resolveChatAgent(membership.tenant.id, params.key)) return new Response("Agent not available", { status: 404 });
  return Response.json({ conversations: listConversations(membership.tenant.id, me.id, params.key) });
}

/** One-time move of chats an older page kept in this browser onto the server. */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const me = await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  if (!resolveChatAgent(membership.tenant.id, params.key)) return new Response("Agent not available", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { conversations?: unknown };
  const list = Array.isArray(body.conversations) ? body.conversations : [];
  return Response.json({ imported: importConversations(membership.tenant.id, me.id, params.key, list) });
}
