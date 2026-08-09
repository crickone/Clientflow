import crypto from "node:crypto";
import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { TOOLS, type ToolArtifact } from "@/lib/assistant/tools";
import { AiCapError } from "@/lib/ai/usage";
import { runWithTenant } from "@/lib/db/tenant";
import { getAgent } from "@/lib/agents/registry";
import { composeAgentSystem } from "@/lib/agents/context";
import { SPECIALISTS } from "@/lib/agents/specialists";
import { runAgentTurn, type PendingWrite } from "@/lib/agents/runAgentTurn";
import { createRun, updateRunText, finishRun } from "@/lib/agents/runStore";

/**
 * Scoped specialist chat route — the same streaming tool-loop as
 * `/api/assistant/chat`, but pinned to ONE named agent's playbook + tool
 * slice instead of the full general-purpose assistant. Only agents in
 * `SPECIALISTS` (@/lib/agents/specialists) that are marked "active" in
 * `AGENT_CATALOG` are reachable — any other AGENT_CATALOG key 404s below
 * before any tool slice or system prompt is built, whether because it's
 * still seeded "dormant" there or because it has no matching `SPECIALISTS`
 * entry yet.
 *
 * Everything except the system prompt, tool slice, model, and metering key is
 * copied verbatim from `/api/assistant/chat` — see that file for the
 * annotated original (auth, runWithTenant, the write→confirm deferral, SSE
 * framing, and the per-tenant AI spend cap are all identical here).
 *
 * DR1 (durable runs — .superpowers/sdd/durableruns-design.md): this route no
 * longer aborts the loop on a client disconnect. Railway runs this app as a
 * persistent `next start` Node process (not serverless), and the whole loop
 * already ran in a detached `void runWithTenant(async () => {…})` IIFE that
 * keeps executing after the SSE Response returns — the ONLY thing that used
 * to kill that work early was passing `req.signal` into `runAgentTurn`, which
 * broke its loop the instant the browser tab closed/refreshed/navigated away.
 * That signal is no longer passed, and progress is persisted to a durable
 * `agent_runs` row (@/lib/agents/runStore) as the run streams + once it
 * finishes, so the run now survives a disconnect and is recoverable (a resume
 * endpoint + client reconnect is a separate follow-up task, DR2).
 * `/api/assistant/chat` (Communication) is UNCHANGED by this task — it still
 * passes `req.signal` and still dies on disconnect; migrating it is a
 * separate follow-up, not this one.
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
  // to resolve before entering runWithTenant below. Any agent that's still
  // "dormant" in AGENT_CATALOG (@/lib/agents/registry) 404s instead of
  // silently running with no playbook/tool slice — same for a hypothetical
  // active row with no matching SPECIALISTS entry (shouldn't happen, but
  // fails closed).
  const key = params.key;
  const agent = getAgent(tenantId, key);
  const spec = SPECIALISTS[key];
  if (!agent || agent.status !== "active" || !spec) return new Response("Agent not available", { status: 404 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("AI is not configured (missing ANTHROPIC_API_KEY).", { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: InMsg[]; conversationId?: string };
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content }));
  if (history.length === 0) return new Response("No messages", { status: 400 });

  // DR1: the client doesn't send this yet (that's DR2 — capturing the `run`
  // frame below + storing it against the conversation for resume-on-reload).
  // Until then every turn is its own conversation as far as `agent_runs` is
  // concerned, which is harmless: this id only threads a run to its
  // conversation for a future GET /api/agents/run/[id]-style resume, and
  // nothing in THIS task reads it back.
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId
      : crypto.randomUUID();

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
  //
  // DR1: this IIFE is now the durable run itself — nothing below aborts it on
  // client disconnect (see the file-level doc comment). `runId` is declared
  // `let`, OUTSIDE the try, purely so the outer `catch` can tell whether a run
  // row actually exists to mark as errored (it won't if `createRun` itself is
  // what threw); everywhere else uses the `const id` alias captured right
  // after creation, which TS (correctly) knows is never undefined.
  void runWithTenant(tenantId, async () => {
    let runId: string | undefined;
    try {
      const id = createRun(tenantId, { conversationId, agentKey: key, model });
      runId = id;
      // NEW leading frame (DR1) — lets the client learn the run id so a
      // future reload can resume it (DR2). Sent before anything else; the
      // current client (AssistantChat's SSE handler) ignores unknown frame
      // `type`s, so this is backward-safe until DR2 wires it up.
      await send({ type: "run", runId: id });

      // composeAgentSystem's business-context layer reads the AMBIENT tenant
      // (getBusinessContext(), via the @/lib/db proxy) rather than a tenantId
      // argument — it only uses `tenantId` here for the getAgent() lookup. It
      // MUST be composed inside this runWithTenant scope: building it before
      // entering here would silently mix THIS tenantId's agent config with
      // whatever tenant the ambient context happens to resolve to, with no
      // error thrown. See the doc comment on composeAgentSystem.
      const system = composeAgentSystem(tenantId, key);
      // Already the exact shape runAgentTurn's `messages` wants (plain
      // {role, content: string}[]) — no Anthropic-specific conversion here;
      // that is entirely the chosen ModelProvider's concern now (MP1).
      const convo = history;

      // Throttled persistence of the in-flight run's text (DR1): a fast
      // streaming turn can fire `onText` many times a second, so writing to
      // SQLite on every delta would hammer the tenant DB for no benefit — the
      // reconnect UX (DR2) only needs text that's at most ~a second stale.
      // Persist at most every 750ms during streaming, and unconditionally on
      // every tool boundary (`onTool`) so the persisted text never lags
      // behind a visible step change. The FINAL text is always written
      // exactly once more, synchronously, by `finishRun` below — this
      // throttle only governs the INTERIM writes.
      let accumulatedText = "";
      let lastPersistAt = 0;
      const PERSIST_INTERVAL_MS = 750;
      const persistText = (force: boolean) => {
        const now = Date.now();
        if (!force && now - lastPersistAt < PERSIST_INTERVAL_MS) return;
        lastPersistAt = now;
        updateRunText(tenantId, id, accumulatedText);
      };

      // The tool-use loop (model call -> read tools execute inline, write
      // tools deferred -> repeat) lives in the shared runAgentTurn (same loop
      // the orchestrator's future delegate tools will call). It enforces the
      // per-tenant monthly AI spend cap (assertUnderCap) before its first
      // model call and lets AiCapError propagate here, so this route keeps
      // its existing error+done SSE framing; any other error propagates past
      // this catch to the outer one below, same as before this loop was
      // extracted.
      //
      // DR1: deliberately NOT passing `signal` — that's the whole point of
      // this task. runAgentTurn's `signal?.aborted` checks are simply no-ops
      // when `signal` is undefined, so the loop now only ever stops via the
      // existing 8-turn cap / max_tokens / end_turn — never because the
      // client went away. Do not reintroduce `signal: req.signal` here.
      let text = "";
      let pendingWrites: PendingWrite[] = [];
      let artifacts: ToolArtifact[] = [];
      try {
        ({ text, pendingWrites, artifacts } = await runAgentTurn({
          tenantId,
          agentKey: key,
          userId,
          model,
          system,
          tools,
          messages: convo,
          onText: (t) => {
            void send({ type: "text", text: t });
            accumulatedText += t;
            persistText(false);
          },
          onTool: (n) => {
            void send({ type: "tool", name: n });
            persistText(true);
          },
          onArtifact: (a) => void send({ type: "artifact", ...a }),
        }));
      } catch (e) {
        if (e instanceof AiCapError) {
          finishRun(tenantId, id, { status: "error", error: e.message });
          await send({ type: "error", error: e.message });
          await send({ type: "done" });
          return;
        }
        throw e;
      }

      // Persist the terminal outcome BEFORE the (unchanged) confirm/done
      // frames — a write-approval card must already be recoverable the
      // instant it's shown, not racing the client's next reload against this
      // write.
      finishRun(tenantId, id, {
        status: pendingWrites.length > 0 ? "awaiting_approval" : "done",
        text,
        pending: pendingWrites,
        artifacts,
      });

      if (pendingWrites.length > 0) await send({ type: "confirm", actions: pendingWrites });
      await send({ type: "done" });
    } catch (err) {
      // Keep the real error server-side; never leak internal paths/hostnames.
      console.error(`[agents/${key}] stream error:`, err);
      // Only if a run row actually exists (i.e. we got past `createRun`) —
      // otherwise there is nothing to mark as errored.
      if (runId) finishRun(tenantId, runId, { status: "error", error: "Assistant error" });
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
