import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getTenantDbById, runWithTenant } from "@/lib/db/tenant";
import { agentConversations, campaigns, type AgentConversation } from "@/lib/db/schema";
import { executeTool, type ToolArtifact } from "@/lib/assistant/tools";
import { AiCapError } from "@/lib/ai/usage";
import { composeAgentSystem } from "@/lib/agents/context";
import { resolveChatAgent } from "@/lib/agents/chatAgent";
import { runAgentTurn } from "@/lib/agents/runAgentTurn";
import { humanResult } from "@/components/messaging/chatText";
import {
  campaignGoAgainMessage,
  campaignPlanEventFromActions,
  campaignProgressEventFromResult,
  type CampaignProgressEvent,
} from "@/components/messaging/campaignProgress";
import {
  AUTOPILOT_MAX_TURNS,
  AUTOPILOT_NUDGE,
  campaignIdFromResult,
  continuationMessage,
  decideAfterTurn,
  resumeMessage,
  type AutopilotResult,
} from "@/lib/agents/autopilotModel";
import {
  modelHistory,
  normalizeImported,
  type ConvAction,
  type ConversationSummary,
  type ConversationView,
  type ConvMessage,
} from "@/lib/agents/conversationModel";

/**
 * Adonis, run by the server.
 *
 * Every conversation lives here, per user. The chat page only sends what the
 * operator did (a message, an Approve click, Go again, Build the rest, Stop)
 * and shows the conversation as it changes; everything else — each turn, each
 * tool, carrying on after an approval, building a whole campaign — runs in a
 * detached, tenant-bound continuation on this persistent `next start` process.
 * Closing the page, moving to another screen or picking up a phone changes
 * nothing about what Adonis is doing.
 *
 * The write gate holds exactly as before: Adonis proposes writes, they wait
 * as an Approve card, and only the operator's click runs them. The one thing
 * approved in advance is "Approve and build everything" / "Build the rest",
 * which covers approve_campaign_asset for that one campaign (decideAfterTurn)
 * — launching, scheduling, sending and publishing always come back as a card.
 */

type Ctx = { tenantId: number; userId: number; agentKey: string; convId: string };

type Conv = {
  id: string;
  title: string;
  messages: ConvMessage[];
  campaignEvents: CampaignProgressEvent[];
  status: "idle" | "running";
  building: boolean;
  campaignId: number | null;
  stopRequested: boolean;
  updatedAt: number;
};

/** Conversations with a turn in progress in THIS process. A row marked running that isn't here was cut off by a restart. */
const live = new Set<string>();
const liveKey = (c: Ctx) => `${c.tenantId}:${c.convId}`;

const SAVE_EVERY_MS = 500;

function db(tenantId: number) {
  return getTenantDbById(tenantId);
}

function parse(row: AgentConversation): Conv {
  return {
    id: row.id,
    title: row.title,
    messages: JSON.parse(row.messages) as ConvMessage[],
    campaignEvents: JSON.parse(row.campaignEvents) as CampaignProgressEvent[],
    status: row.status,
    building: row.building,
    campaignId: row.campaignId,
    stopRequested: row.stopRequested,
    updatedAt: row.updatedAt.getTime(),
  };
}

function row(c: Ctx): AgentConversation | undefined {
  return db(c.tenantId)
    .select()
    .from(agentConversations)
    .where(and(eq(agentConversations.id, c.convId), eq(agentConversations.userId, c.userId), eq(agentConversations.agentKey, c.agentKey)))
    .get();
}

function write(c: Ctx, conv: Conv): void {
  db(c.tenantId)
    .update(agentConversations)
    .set({
      title: conv.title,
      messages: JSON.stringify(conv.messages),
      campaignEvents: JSON.stringify(conv.campaignEvents),
      status: conv.status,
      building: conv.building,
      campaignId: conv.campaignId,
      stopRequested: conv.stopRequested,
      updatedAt: new Date(),
    })
    .where(eq(agentConversations.id, c.convId))
    .run();
}

/**
 * Load a conversation for its owner. A row left "running" by a process that
 * has since restarted (a deploy mid-turn) is put back to idle with a note, so
 * the operator can carry on instead of waiting on a turn nobody is running.
 */
function load(c: Ctx): Conv | null {
  const r = row(c);
  if (!r) return null;
  const conv = parse(r);
  if (conv.status === "running" && !live.has(liveKey(c))) {
    conv.status = "idle";
    conv.building = false;
    const last = conv.messages[conv.messages.length - 1];
    const note = conv.building || last?.role === "assistant"
      ? "_Adonis was interrupted (the app restarted). Say \"carry on\" to pick it up, or use Build the rest._"
      : "_Adonis was interrupted (the app restarted). Send your message again._";
    if (last?.role === "assistant") last.content = [last.content, note].filter(Boolean).join("\n\n");
    else conv.messages.push({ role: "assistant", content: note, tools: [], artifacts: [] });
    write(c, conv);
  }
  return conv;
}

function view(conv: Conv): ConversationView {
  return {
    id: conv.id,
    title: conv.title,
    updatedAt: conv.updatedAt,
    running: conv.status === "running",
    messages: conv.messages,
    campaignEvents: conv.campaignEvents,
    building: conv.building,
    stopRequested: conv.stopRequested,
  };
}

export function listConversations(tenantId: number, userId: number, agentKey: string): ConversationSummary[] {
  return db(tenantId)
    .select({ id: agentConversations.id, title: agentConversations.title, updatedAt: agentConversations.updatedAt, status: agentConversations.status })
    .from(agentConversations)
    .where(and(eq(agentConversations.userId, userId), eq(agentConversations.agentKey, agentKey)))
    .orderBy(desc(agentConversations.updatedAt))
    .limit(60)
    .all()
    .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.getTime(), running: r.status === "running" && live.has(`${tenantId}:${r.id}`) }));
}

export function getConversation(c: Ctx): ConversationView | null {
  const conv = load(c);
  return conv ? view(conv) : null;
}

export function deleteConversation(c: Ctx): boolean {
  if (live.has(liveKey(c))) return false;
  return (
    db(c.tenantId)
      .delete(agentConversations)
      .where(and(eq(agentConversations.id, c.convId), eq(agentConversations.userId, c.userId)))
      .run().changes > 0
  );
}

/**
 * Bring chats an older page saved in the browser onto the server, once.
 * Ids already held (for anyone) are left alone. Returns how many came across.
 */
export function importConversations(tenantId: number, userId: number, agentKey: string, raw: unknown[]): number {
  let n = 0;
  for (const item of raw.slice(0, 40)) {
    const conv = normalizeImported(item);
    if (!conv) continue;
    const exists = db(tenantId).select({ id: agentConversations.id }).from(agentConversations).where(eq(agentConversations.id, conv.id)).get();
    if (exists) continue;
    db(tenantId)
      .insert(agentConversations)
      .values({
        id: conv.id,
        userId,
        agentKey,
        title: conv.title,
        messages: JSON.stringify(conv.messages),
        campaignEvents: JSON.stringify(conv.campaignEvents),
        createdAt: new Date(conv.updatedAt),
        updatedAt: new Date(conv.updatedAt),
      })
      .run();
    n++;
  }
  return n;
}

export type ConversationAction =
  | { type: "message"; text: string }
  | { type: "approve"; index: number; all?: boolean }
  | { type: "cancel"; index: number }
  | { type: "goAgain"; index: number; tweak: string }
  | { type: "buildRest"; campaignId: number }
  | { type: "stop" };

export class ConversationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Apply what the operator did and, where it calls for Adonis, start it
 * running. Returns the conversation as it stands now; the turn carries on
 * after this returns. Admin rights for approvals are checked by the route.
 */
export function act(c: Ctx, action: ConversationAction): ConversationView {
  let conv = load(c);
  if (action.type === "stop") {
    if (!conv) throw new ConversationError("Conversation not found.", 404);
    if (conv.status === "running") {
      conv.stopRequested = true;
      write(c, conv);
    }
    return view(conv);
  }
  if (conv?.status === "running") throw new ConversationError("Adonis is still working in this chat.", 409);

  if (!conv) {
    if (action.type !== "message") throw new ConversationError("Conversation not found.", 404);
    db(c.tenantId).insert(agentConversations).values({ id: c.convId, userId: c.userId, agentKey: c.agentKey }).run();
    conv = load(c)!;
  }

  const pendingAt = (index: number) => {
    const m = conv!.messages[index];
    if (!m || m.role !== "assistant" || !m.pending || m.pending.status !== "awaiting") {
      throw new ConversationError("That has already been answered.", 409);
    }
    return m;
  };

  let kick: Kick;
  switch (action.type) {
    case "message": {
      const text = action.text.trim();
      if (!text) throw new ConversationError("Nothing to send.", 400);
      if (conv.messages.length === 0 || conv.title === "New chat") conv.title = text.slice(0, 48);
      conv.messages.push({ role: "user", content: text, tools: [], artifacts: [] });
      kick = { kind: "turn" };
      break;
    }
    case "approve": {
      const m = pendingAt(action.index);
      const all = action.all === true && m.pending!.actions.some((a) => a.name === "create_campaign");
      m.pending!.status = "approving";
      kick = { kind: "approve", index: action.index, all };
      break;
    }
    case "cancel": {
      const m = pendingAt(action.index);
      m.pending!.status = "cancelled";
      m.content = [m.content, "_Cancelled — nothing was changed._"].filter(Boolean).join("\n\n");
      write(c, conv);
      return view(conv);
    }
    case "goAgain": {
      const m = pendingAt(action.index);
      const target = m.pending!.actions.find((a) => a.name === "create_campaign" || a.name === "approve_campaign_asset");
      if (!target) throw new ConversationError("Nothing to redo.", 400);
      m.pending!.status = "cancelled";
      m.content = [m.content, "_Asked for another draft…_"].filter(Boolean).join("\n\n");
      conv.messages.push({ role: "user", content: campaignGoAgainMessage(target, action.tweak), tools: [], artifacts: [] });
      kick = { kind: "turn" };
      break;
    }
    case "buildRest": {
      const camp = db(c.tenantId)
        .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, action.campaignId))
        .get();
      if (!camp) throw new ConversationError("Campaign not found.", 404);
      if (camp.status !== "building" && camp.status !== "ready") throw new ConversationError("That campaign is already launched.", 400);
      kick = { kind: "resume", campaign: { id: camp.id, name: camp.name } };
      break;
    }
  }

  conv.status = "running";
  conv.stopRequested = false;
  write(c, conv);
  live.add(liveKey(c));
  void runWithTenant(c.tenantId, () => drive(c, kick));
  return view(load(c)!);
}

type Kick =
  | { kind: "turn" }
  | { kind: "approve"; index: number; all: boolean }
  | { kind: "resume"; campaign: { id: number; name: string } };

/** The loop: take turns until Adonis needs the operator. Runs detached; `live` already holds this conversation. */
async function drive(c: Ctx, kick: Kick): Promise<void> {
  const conv = parse(row(c)!);
  let lastSave = 0;
  const save = () => {
    lastSave = Date.now();
    write(c, conv);
  };
  const stopAsked = () => row(c)?.stopRequested === true;

  const execute = async (actions: ConvAction[]) => {
    const out: (AutopilotResult & { artifact?: ToolArtifact })[] = [];
    for (const a of actions) {
      try {
        const r = await executeTool(a.name, a.input ?? {}, { tenantId: c.tenantId, userId: c.userId });
        out.push({ name: a.name, ok: true, text: r.text, artifact: r.artifact });
      } catch (err) {
        out.push({ name: a.name, ok: false, text: err instanceof Error ? err.message : "Action failed." });
      }
    }
    return out;
  };
  /** Show what an approval did on its card, and log campaign progress. */
  const record = (m: ConvMessage, results: Awaited<ReturnType<typeof execute>>, auto: boolean) => {
    const lines = results.map((r) => (r.ok ? humanResult(r.text) : `Failed: ${humanResult(r.text)}`)).join("\n\n");
    m.content = [m.content, auto ? "_Approved automatically._" : "", lines].filter(Boolean).join("\n\n");
    for (const r of results) {
      if (r.artifact) m.artifacts.push({ url: r.artifact.url, filename: r.artifact.filename, label: r.artifact.label });
      const e = r.ok ? campaignProgressEventFromResult(r.name, r.text) : null;
      if (e) conv.campaignEvents.push(e);
      conv.campaignId = campaignIdFromResult(r.name, r.text) ?? conv.campaignId;
    }
  };

  try {
    const resolved = resolveChatAgent(c.tenantId, c.agentKey);
    if (!resolved) throw new Error("Adonis isn't available on this account.");
    const system = composeAgentSystem(c.tenantId, c.agentKey);

    let next: string | null = null; // the hidden hand-back that opens the next turn
    if (kick.kind === "approve") {
      const card = conv.messages[kick.index];
      const actions = card.pending!.actions;
      const results = await execute(actions);
      card.pending!.status = "approved";
      record(card, results, false);
      const ok = results.every((r) => r.ok);
      conv.building = kick.all && ok && conv.campaignId !== null;
      next = continuationMessage(results, { auto: false, autopilot: conv.building });
      save();
    } else if (kick.kind === "resume") {
      conv.building = true;
      conv.campaignId = kick.campaign.id;
      next = resumeMessage(kick.campaign);
    }

    let nudges = 0;
    for (let turn = 0; ; turn++) {
      if (turn >= AUTOPILOT_MAX_TURNS) {
        conv.messages.push({ role: "assistant", content: "_Adonis stopped after a long run. Say \"carry on\" to continue._", tools: [], artifacts: [] });
        break;
      }
      if (turn > 0 && stopAsked()) break;
      if (next) conv.messages.push({ role: "user", hidden: true, content: next, tools: [], artifacts: [] });
      const reply: ConvMessage = { role: "assistant", content: "", tools: [], artifacts: [] };
      const history = modelHistory(conv.messages);
      conv.messages.push(reply);
      save();

      const out = await runAgentTurn({
        tenantId: c.tenantId,
        agentKey: c.agentKey,
        userId: c.userId,
        model: resolved.model,
        system,
        tools: resolved.tools,
        messages: history,
        onText: (t) => {
          reply.content += t;
          if (Date.now() - lastSave > SAVE_EVERY_MS) save();
        },
        onTool: (n) => {
          reply.tools.push(n);
          save();
        },
      });
      reply.content = out.text;
      for (const a of out.artifacts) {
        if (!reply.artifacts.some((x) => x.url === a.url)) reply.artifacts.push({ url: a.url, filename: a.filename, label: a.label });
      }

      const decision = decideAfterTurn({ pending: out.pendingWrites, autopilot: conv.building, campaignId: conv.campaignId, nudges });
      if (decision === "ask") {
        reply.pending = { actions: out.pendingWrites, status: "awaiting" };
        const plan = campaignPlanEventFromActions(out.pendingWrites);
        if (plan) conv.campaignEvents.push(plan);
        break;
      }
      if (decision === "finish") break;
      if (decision === "nudge") {
        nudges++;
        next = AUTOPILOT_NUDGE;
        continue;
      }
      // "approve": the operator approved these in advance.
      reply.pending = { actions: out.pendingWrites, status: "approving" };
      save();
      const results = await execute(out.pendingWrites);
      reply.pending.status = "approved";
      record(reply, results, true);
      if (results.some((r) => !r.ok)) conv.building = false;
      nudges = 0;
      next = continuationMessage(results, { auto: true, autopilot: conv.building });
    }
  } catch (err) {
    const msg = err instanceof AiCapError ? err.message : "Something went wrong. Say \"carry on\" to try again.";
    if (!(err instanceof AiCapError)) console.error(`[adonis ${c.convId}]`, err);
    const last = conv.messages[conv.messages.length - 1];
    if (last?.role === "assistant") last.content = [last.content, `_Error: ${msg}_`].filter(Boolean).join("\n\n");
    else conv.messages.push({ role: "assistant", content: `_Error: ${msg}_`, tools: [], artifacts: [] });
  } finally {
    conv.status = "idle";
    conv.building = false;
    conv.stopRequested = false;
    write(c, conv);
    live.delete(liveKey(c));
  }
}
