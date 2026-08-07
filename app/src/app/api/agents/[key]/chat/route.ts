import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { TOOLS } from "@/lib/assistant/tools";
import { getAnthropic } from "@/lib/ai/client";
import { AiCapError } from "@/lib/ai/usage";
import { runWithTenant } from "@/lib/db/tenant";
import { getAgent } from "@/lib/agents/registry";
import { composeAgentSystem } from "@/lib/agents/context";
import { SPECIALISTS } from "@/lib/agents/specialists";
import { runAgentTurn, type PendingWrite } from "@/lib/agents/runAgentTurn";

/**
 * Scoped specialist chat route — the same streaming tool-loop as
 * `/api/assistant/chat`, but pinned to ONE named agent's playbook + tool
 * slice instead of the full general-purpose assistant. Only the agents
 * registered in `SPECIALISTS` (@/lib/agents/specialists) AND marked "active"
 * in `AGENT_CATALOG` are reachable — sales and marketing today; every other
 * AGENT_CATALOG key (orchestrator, seo, operations, finance) is seeded
 * "dormant" and 404s below before any tool slice or system prompt is built.
 *
 * Everything except the system prompt, tool slice, model, and metering key is
 * copied verbatim from `/api/assistant/chat` — see that file for the
 * annotated original (auth, runWithTenant, the write→confirm deferral, SSE
 * framing, and the per-tenant AI spend cap are all identical here).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type InMsg = { role: "user" | "assistant"; content: string };

export async function POST(
  req: NextRequest,
  { params }: { params: { key: string } },
) {
  const me = await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  const tenantId = membership.tenant.id;
  const userId = me.id;

  // Gate: only an agent that is BOTH marked "active" in the registry AND has
  // a SPECIALISTS entry (its tool slice + playbook) is reachable here.
  // getAgent takes an explicit tenantId (not the ambient one) so this is safe
  // to resolve before entering runWithTenant below. Dormant specialists
  // (everything but sales/marketing today) 404 instead of silently running
  // with no playbook/tool slice — same for a hypothetical active row with no
  // matching SPECIALISTS entry (shouldn't happen, but fails closed).
  const key = params.key;
  const agent = getAgent(tenantId, key);
  const spec = SPECIALISTS[key];
  if (!agent || agent.status !== "active" || !spec) return new Response("Agent not available", { status: 404 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("AI is not configured (missing ANTHROPIC_API_KEY).", { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: InMsg[] };
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content }));
  if (history.length === 0) return new Response("No messages", { status: 400 });

  // Built in request scope; the async loop below uses only tenantId + these
  // values. Unlike `system` (composed below, inside runWithTenant), this tool
  // slice needs no ambient tenant state — it's a pure name-filter over the
  // static TOOLS registry — so it's safe to compute here.
  // Set<string> (not the inferred literal-union type): compared below against
  // t.name, which is a plain `string` on the Anthropic.Tool type.
  const allowed = new Set<string>(spec.toolNames); // per-agent tool slice
  const tools = TOOLS.filter((t) => allowed.has(t.name));
  const model = agent.model; // registry model: Sonnet default, Opus if upgraded — never hardcoded

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  // Swallow write failures: when the browser closes the SSE stream mid-answer the
  // writer rejects, and an unhandled rejection here would take down the whole
  // Node process (which serves every tenant).
  const send = (obj: unknown) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)).catch(() => {});

  // Bind the tenant for the WHOLE detached loop. This IIFE runs after the Response
  // returns, so cookie-based scope is unreliable — runWithTenant makes the db
  // proxy, getBusinessProfile/getTheme, and sendEmail resolve to THIS tenant even
  // deep inside tools like send_client_email (which use request-scoped helpers).
  void runWithTenant(tenantId, async () => {
    try {
      // composeAgentSystem's business-context layer reads the AMBIENT tenant
      // (getBusinessContext(), via the @/lib/db proxy) rather than a tenantId
      // argument — it only uses `tenantId` here for the getAgent() lookup. It
      // MUST be composed inside this runWithTenant scope: building it before
      // entering here would silently mix THIS tenantId's agent config with
      // whatever tenant the ambient context happens to resolve to, with no
      // error thrown. See the doc comment on composeAgentSystem.
      const system = composeAgentSystem(tenantId, key);
      const convo: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

      // The tool-use loop (model call -> read tools execute inline, write
      // tools deferred -> repeat) lives in the shared runAgentTurn (same loop
      // the orchestrator's future delegate tools will call). It enforces the
      // per-tenant monthly AI spend cap (assertUnderCap) before its first
      // model call and lets AiCapError propagate here, so this route keeps
      // its existing error+done SSE framing; any other error propagates past
      // this catch to the outer one below, same as before this loop was
      // extracted.
      let pendingWrites: PendingWrite[] = [];
      try {
        ({ pendingWrites } = await runAgentTurn({
          anthropic: getAnthropic(),
          tenantId,
          agentKey: key,
          userId,
          model,
          system,
          tools,
          messages: convo,
          signal: req.signal,
          onText: (t) => void send({ type: "text", text: t }),
          onTool: (n) => void send({ type: "tool", name: n }),
          onArtifact: (a) => void send({ type: "artifact", ...a }),
        }));
      } catch (e) {
        if (e instanceof AiCapError) {
          await send({ type: "error", error: e.message });
          await send({ type: "done" });
          return;
        }
        throw e;
      }

      if (pendingWrites.length > 0) await send({ type: "confirm", actions: pendingWrites });
      await send({ type: "done" });
    } catch (err) {
      // Keep the real error server-side; never leak internal paths/hostnames.
      console.error(`[agents/${key}] stream error:`, err);
      await send({ type: "error", error: "Assistant error" });
    } finally {
      try {
        await writer.close();
      } catch {
        /* stream already closed by the client */
      }
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
