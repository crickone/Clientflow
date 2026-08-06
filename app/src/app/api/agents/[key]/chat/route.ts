import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { executeTool, isWriteTool, summarizeToolAction, TOOLS } from "@/lib/assistant/tools";
import { getAnthropic } from "@/lib/ai/client";
import { assertUnderCap, recordUsage, AiCapError } from "@/lib/ai/usage";
import { runWithTenant } from "@/lib/db/tenant";
import { getAgent } from "@/lib/agents/registry";
import { composeAgentSystem } from "@/lib/agents/context";
import { SALES_SPECIALIST } from "@/lib/agents/specialists/sales";

/**
 * Scoped specialist chat route — the same streaming tool-loop as
 * `/api/assistant/chat`, but pinned to ONE named agent's playbook + tool
 * slice instead of the full general-purpose assistant. Only `SALES_SPECIALIST`
 * is wired today; every other AGENT_CATALOG key (orchestrator, seo,
 * marketing, operations, finance) is seeded "dormant" and 404s below before
 * any tool slice or system prompt is built.
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

  // Gate: only an ACTIVE agent is reachable here. getAgent takes an explicit
  // tenantId (not the ambient one) so this is safe to resolve before entering
  // runWithTenant below. Dormant specialists (everything but "sales" today)
  // 404 instead of silently running with no playbook/tool slice.
  const key = params.key;
  const agent = getAgent(tenantId, key);
  if (!agent || agent.status !== "active") return new Response("Agent not available", { status: 404 });

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
  const allowed = new Set<string>(SALES_SPECIALIST.toolNames); // per-agent tool slice
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
      const anthropic = getAnthropic();
      const convo: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

      // Enforce the per-gym monthly AI spend cap before burning any tokens on
      // this request. Reuses the route's existing send()/writer-close
      // mechanics: return here lets the outer finally below close the writer,
      // same as every other exit path in this function.
      try {
        assertUnderCap(tenantId);
      } catch (e) {
        if (e instanceof AiCapError) {
          await send({ type: "error", error: e.message });
          await send({ type: "done" });
          return;
        }
        throw e;
      }

      for (let turn = 0; turn < 8; turn++) {
        if (req.signal.aborted) break; // client disconnected — stop burning tokens
        const stream = anthropic.messages.stream({
          model,
          // Full nutrition/workout plans serialise to large tool inputs; 4096 was
          // truncating them mid-JSON, which failed and made the model retry.
          max_tokens: 16000,
          system,
          tools,
          messages: convo,
        });
        stream.on("text", (delta) => {
          void send({ type: "text", text: delta });
        });
        const final = await stream.finalMessage();
        recordUsage(tenantId, key, model, {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
          cacheReadTokens: (final.usage as any).cache_read_input_tokens ?? 0,
          cacheCreateTokens: (final.usage as any).cache_creation_input_tokens ?? 0,
        });
        convo.push({ role: "assistant", content: final.content });

        // A tool call that got cut off by the token limit is malformed — don't
        // feed it back (that just loops). Tell the user and stop cleanly.
        if (final.stop_reason === "max_tokens") {
          await send({ type: "text", text: "\n\n_(That response was longer than expected — please ask me to continue or narrow it down.)_" });
          break;
        }

        if (final.stop_reason === "tool_use") {
          const results: Anthropic.ToolResultBlockParam[] = [];
          const pending: { name: string; input: Record<string, unknown>; summary: string }[] = [];
          for (const block of final.content) {
            if (block.type === "tool_use") {
              const input = block.input as Record<string, unknown>;
              if (isWriteTool(block.name)) {
                // NEVER execute a write in the chat loop. Collect it and hand it
                // to the UI for an explicit Approve click — this is the code-level
                // guard against prompt injection driving a real action. Approval
                // POSTs to the shared /api/assistant/execute, which re-validates
                // via this same isWriteTool/WRITE_TOOLS set.
                pending.push({ name: block.name, input, summary: summarizeToolAction(block.name, input) });
              } else {
                await send({ type: "tool", name: block.name });
                const r = await executeTool(block.name, input, { tenantId, userId });
                if (r.artifact) await send({ type: "artifact", ...r.artifact });
                results.push({ type: "tool_result", tool_use_id: block.id, content: r.text });
              }
            }
          }
          if (pending.length > 0) {
            await send({ type: "confirm", actions: pending });
            break; // wait for the user to approve/cancel in the UI
          }
          convo.push({ role: "user", content: results });
          continue;
        }
        break;
      }
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
