import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { buildAssistantSystem } from "@/lib/assistant/system";
import { executeTool, isWriteTool, summarizeToolAction, conciergeToolSlice } from "@/lib/assistant/tools";
import { getAnthropic, MODELS } from "@/lib/ai/client";
import { assertUnderCap, recordUsage, AiCapError } from "@/lib/ai/usage";
import { runWithTenant } from "@/lib/db/tenant";
import { getSchedulingMode } from "@/lib/settings";
import { isDriveConnected } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type InMsg = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  const tenantId = membership.tenant.id;
  const userId = me.id;

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("AI is not configured (missing ANTHROPIC_API_KEY).", { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: InMsg[] };
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content }));
  if (history.length === 0) return new Response("No messages", { status: 400 });

  // Built in request scope; the async loop below uses only tenantId + these values.
  const schedulingMode = getSchedulingMode();
  const driveConnected = isDriveConnected(tenantId);
  const system = buildAssistantSystem(schedulingMode, driveConnected);
  // This route IS the Concierge — its tool slice (scoped to the account's
  // scheduling mode + Drive connection, delegate_to_* excluded) is the single
  // `conciergeToolSlice` also used by the orchestrator's delegate_to_concierge
  // tool (@/lib/agents/tools.orchestrator), so both run the Concierge on the
  // exact same tools. See that function's doc comment for why delegate_to_*
  // must never be offered here specifically (this loop doesn't read a tool
  // result's pendingWrites the way runAgentTurn's READ branch does).
  const tools = conciergeToolSlice(schedulingMode, driveConnected);

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
          model: MODELS.sonnet,
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
        recordUsage(tenantId, "assistant", MODELS.sonnet, {
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
                // guard against prompt injection driving a real action.
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
      console.error("[assistant] stream error:", err);
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
