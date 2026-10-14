import "server-only";

import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { agentAutopilot, type AgentAutopilot } from "@/lib/db/schema";
import { executeTool, type ToolArtifact } from "@/lib/assistant/tools";
import { AiCapError } from "@/lib/ai/usage";
import { composeAgentSystem } from "@/lib/agents/context";
import { resolveChatAgent } from "@/lib/agents/chatAgent";
import { runAgentTurn } from "@/lib/agents/runAgentTurn";
import { humanResult } from "@/components/messaging/chatText";
import {
  AUTOPILOT_MAX_TURNS,
  AUTOPILOT_NUDGE,
  campaignIdFromResult,
  continuationMessage,
  resumeMessage,
  decideAfterTurn,
  type AutopilotMessage,
  type AutopilotResult,
  type AutopilotStatus,
  type AutopilotView,
} from "@/lib/agents/autopilotModel";

/**
 * "Approve and build everything", run by the server.
 *
 * The chat used to drive this itself: after each turn it approved the
 * proposed asset and sent the next "carry on" message. Leaving the page
 * unmounted the chat and the build stopped half way. Now the chat starts a
 * job here and only watches it (GET /api/agents/autopilot/[id]); the job
 * keeps taking turns in a detached, tenant-bound continuation (Railway runs
 * this app as a persistent `next start` process — the same thing that makes
 * the chat route's durable runs work) until it needs the operator.
 *
 * The write gate holds: the operator's click on "Approve and build
 * everything" is the approval, and it covers only approve_campaign_asset for
 * the campaign this job created (decideAfterTurn). Launching, scheduling,
 * sending and publishing are handed back as an ordinary Approve card.
 */

type InMsg = { role: "user" | "assistant"; content: string };
type StartResult = AutopilotResult & { artifact?: ToolArtifact };

// A running job not touched for this long was cut off by a restart or
// redeploy. A single step (designing a carousel) can take a couple of
// minutes, so this is well above that.
const STALE_MS = 8 * 60 * 1000;
const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSIST_MS = 1000;

function db(tenantId: number) {
  return getTenantDbById(tenantId);
}

function toView(row: AgentAutopilot): AutopilotView {
  let status = row.status as AutopilotStatus;
  let error = row.error;
  if (status === "running" && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    status = "error";
    error = "The build was interrupted (the server restarted). Say \"carry on\" and Adonis will pick it up.";
  }
  return {
    id: row.id,
    status,
    stopRequested: row.stopRequested,
    startResults: row.startResults ? (JSON.parse(row.startResults) as StartResult[]) : null,
    messages: JSON.parse(row.messages) as AutopilotMessage[],
    error,
  };
}

export function getAutopilot(tenantId: number, id: string): AutopilotView | null {
  const row = db(tenantId).select().from(agentAutopilot).where(eq(agentAutopilot.id, id)).get();
  return row ? toView(row) : null;
}

/** A job still building in this conversation, if any. */
export function runningAutopilotFor(tenantId: number, conversationId: string): AutopilotView | null {
  const rows = db(tenantId)
    .select()
    .from(agentAutopilot)
    .where(and(eq(agentAutopilot.conversationId, conversationId), eq(agentAutopilot.status, "running")))
    .all();
  return rows.map(toView).find((v) => v.status === "running") ?? null;
}

/** "Stop after this one": the loop checks this between turns. */
export function requestAutopilotStop(tenantId: number, id: string): boolean {
  return (
    db(tenantId)
      .update(agentAutopilot)
      .set({ stopRequested: true, updatedAt: new Date() })
      .where(and(eq(agentAutopilot.id, id), eq(agentAutopilot.status, "running")))
      .run().changes > 0
  );
}

function stopRequested(tenantId: number, id: string): boolean {
  const row = db(tenantId).select({ s: agentAutopilot.stopRequested }).from(agentAutopilot).where(eq(agentAutopilot.id, id)).get();
  return row?.s === true;
}

/** Create the job row (status running) and return its id. Prunes week-old jobs. */
export function createAutopilot(args: { tenantId: number; agentKey: string; conversationId: string }): string {
  const id = crypto.randomUUID();
  const cutoff = new Date(Date.now() - PRUNE_AGE_MS);
  db(args.tenantId).delete(agentAutopilot).where(lt(agentAutopilot.createdAt, cutoff)).run();
  db(args.tenantId)
    .insert(agentAutopilot)
    .values({ id, conversationId: args.conversationId, agentKey: args.agentKey })
    .run();
  return id;
}

/**
 * The loop. Call inside runWithTenant(tenantId, ...), detached from the
 * request. `history` is the conversation so far. Either `actions` is the
 * create_campaign the operator approved (the last message's card), or
 * `resume` is a part-built campaign they asked to finish.
 */
export async function runAutopilot(args: {
  jobId: string;
  tenantId: number;
  userId: number;
  agentKey: string;
  history: InMsg[];
  actions: { name: string; input: Record<string, unknown> }[];
  resume?: { id: number; name: string };
}): Promise<void> {
  const { jobId, tenantId, userId, agentKey } = args;
  const messages: AutopilotMessage[] = [];
  let campaignId: number | null = null;
  let lastPersist = 0;

  const save = (patch: Partial<typeof agentAutopilot.$inferInsert> = {}) => {
    lastPersist = Date.now();
    db(tenantId)
      .update(agentAutopilot)
      .set({ messages: JSON.stringify(messages), campaignId, ...patch, updatedAt: new Date() })
      .where(eq(agentAutopilot.id, jobId))
      .run();
  };
  const finish = (status: AutopilotStatus, error?: string) => save({ status, error: error ?? null });

  const execute = async (actions: { name: string; input: Record<string, unknown> }[]): Promise<StartResult[]> => {
    const out: StartResult[] = [];
    for (const a of actions) {
      try {
        const r = await executeTool(a.name, a.input ?? {}, { tenantId, userId });
        out.push({ name: a.name, ok: true, text: r.text, artifact: r.artifact });
      } catch (err) {
        out.push({ name: a.name, ok: false, text: err instanceof Error ? err.message : "Action failed." });
      }
    }
    return out;
  };
  const resultLines = (rs: AutopilotResult[]) =>
    rs.map((r) => (r.ok ? humanResult(r.text) : `Failed: ${humanResult(r.text)}`)).join("\n\n");

  try {
    const resolved = resolveChatAgent(tenantId, agentKey);
    if (!resolved) return finish("error", "Adonis isn't available on this account.");
    const system = composeAgentSystem(tenantId, agentKey);

    const convo: InMsg[] = [...args.history];
    let autopilot: boolean;
    let next: string;
    if (args.resume) {
      campaignId = args.resume.id;
      autopilot = true;
      next = resumeMessage(args.resume);
    } else {
      // The approval the operator clicked.
      const start = await execute(args.actions);
      for (const r of start) campaignId = campaignIdFromResult(r.name, r.text) ?? campaignId;
      save({ startResults: JSON.stringify(start) });
      const last = convo[convo.length - 1];
      if (last?.role === "assistant") convo[convo.length - 1] = { ...last, content: [last.content, resultLines(start)].filter(Boolean).join("\n\n") };
      autopilot = start.every((r) => r.ok) && campaignId !== null;
      next = continuationMessage(start, { auto: false, autopilot });
    }
    let nudges = 0;

    for (let turn = 0; ; turn++) {
      if (turn >= AUTOPILOT_MAX_TURNS) return finish("done", "Adonis stopped after a long run. Say \"carry on\" to continue.");
      if (stopRequested(tenantId, jobId)) return finish("stopped");

      const user: AutopilotMessage = { role: "user", hidden: true, content: next, tools: [], artifacts: [] };
      const reply: AutopilotMessage = { role: "assistant", content: "", tools: [], artifacts: [] };
      messages.push(user, reply);
      save();

      const { text, pendingWrites, artifacts } = await runAgentTurn({
        tenantId,
        agentKey,
        userId,
        model: resolved.model,
        system,
        tools: resolved.tools,
        messages: [...convo, { role: "user" as const, content: next }].slice(-24),
        onText: (t) => {
          reply.content += t;
          if (Date.now() - lastPersist > PERSIST_MS) save();
        },
        onTool: (n) => {
          if (!reply.tools.includes(n)) reply.tools.push(n);
          save();
        },
      });
      reply.content = text;
      reply.artifacts = artifacts.map((a) => ({ url: a.url, filename: a.filename, label: a.label }));
      convo.push({ role: "user", content: next }, { role: "assistant", content: text });

      const decision = decideAfterTurn({ pending: pendingWrites, autopilot, campaignId, nudges });
      if (decision === "ask") {
        reply.pending = { actions: pendingWrites, status: "awaiting" };
        return finish("awaiting_approval");
      }
      if (decision === "finish") return finish("done");
      if (decision === "nudge") {
        nudges++;
        next = AUTOPILOT_NUDGE;
        continue;
      }

      // decision === "approve": the operator approved these in advance.
      reply.pending = { actions: pendingWrites, status: "approved" };
      save();
      const results = await execute(pendingWrites);
      reply.results = results.map(({ name, ok, text }) => ({ name, ok, text }));
      reply.content = [reply.content, "_Approved automatically._", resultLines(results)].filter(Boolean).join("\n\n");
      for (const r of results) if (r.artifact) reply.artifacts.push({ url: r.artifact.url, filename: r.artifact.filename, label: r.artifact.label });
      convo[convo.length - 1] = { role: "assistant", content: reply.content };
      if (results.some((r) => !r.ok)) autopilot = false;
      nudges = 0;
      next = continuationMessage(results, { auto: true, autopilot });
    }
  } catch (err) {
    if (err instanceof AiCapError) return finish("error", err.message);
    console.error(`[autopilot ${jobId}]`, err);
    finish("error", "Something went wrong while building. Say \"carry on\" and Adonis will pick it up.");
  }
}
