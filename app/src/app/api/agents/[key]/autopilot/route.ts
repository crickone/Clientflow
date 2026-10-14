import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { runWithTenant } from "@/lib/db/tenant";
import { resolveChatAgent } from "@/lib/agents/chatAgent";
import { eq } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { campaigns } from "@/lib/db/schema";
import { createAutopilot, runAutopilot, runningAutopilotFor } from "@/lib/agents/autopilot";

export const dynamic = "force-dynamic";

type InMsg = { role: "user" | "assistant"; content: string };

/**
 * "Approve and build everything" on a campaign plan: run the approved
 * create_campaign (or, with `campaignId`, pick up a part-built campaign —
 * "Build the rest" on the chat's checklist), then keep building the kit on
 * the server until it needs
 * the operator (lib/agents/autopilot.ts). Returns the job id at once; the
 * chat follows it with GET /api/agents/autopilot/[id], so the build carries
 * on when the operator leaves the page.
 *
 * Admin-only, like /api/assistant/execute: this click IS a write approval.
 */
export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const me = await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  if (membership.role !== "admin") {
    return Response.json({ ok: false, error: "Only admins can approve and run agent actions." }, { status: 403 });
  }
  const tenantId = membership.tenant.id;

  const rl = rateLimit(`agent-autopilot:${me.id}`, 10, 60_000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: "Too many requests — please slow down and try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const key = params.key;
  if (!resolveChatAgent(tenantId, key)) return Response.json({ ok: false, error: "Agent not available." }, { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, error: "AI is not configured." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    conversationId?: unknown;
    messages?: InMsg[];
    actions?: { name?: unknown; input?: unknown }[];
    campaignId?: unknown;
  };
  const conversationId = typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId : null;
  if (!conversationId) return Response.json({ ok: false, error: "No conversation." }, { status: 400 });

  // Only a campaign plan starts a build: the button exists on that card alone.
  const actions = (Array.isArray(body.actions) ? body.actions : [])
    .filter((a) => a && a.name === "create_campaign")
    .map((a) => ({ name: "create_campaign", input: (a.input && typeof a.input === "object" ? a.input : {}) as Record<string, unknown> }));
  let resume: { id: number; name: string } | undefined;
  if (actions.length === 0 && Number.isInteger(body.campaignId)) {
    const row = getTenantDbById(tenantId)
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, body.campaignId as number))
      .get();
    if (!row) return Response.json({ ok: false, error: "Campaign not found." }, { status: 404 });
    if (row.status !== "building" && row.status !== "ready") {
      return Response.json({ ok: false, error: "That campaign is already launched." }, { status: 400 });
    }
    resume = { id: row.id, name: row.name };
  } else if (actions.length !== 1) {
    return Response.json({ ok: false, error: "Nothing to build." }, { status: 400 });
  }

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content }));

  if (runningAutopilotFor(tenantId, conversationId)) {
    return Response.json({ ok: false, error: "Adonis is already building in this chat." }, { status: 409 });
  }

  const jobId = createAutopilot({ tenantId, agentKey: key, conversationId });
  void runWithTenant(tenantId, () =>
    runAutopilot({ jobId, tenantId, userId: me.id, agentKey: key, history, actions, resume }),
  );
  return Response.json({ ok: true, jobId });
}
