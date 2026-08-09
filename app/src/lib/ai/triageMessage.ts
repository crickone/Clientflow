import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { tags as tagsTable } from "@/lib/db/schema";
import { getBusinessName, getInboxBusinessFacts } from "@/lib/ai/businessContext";
import { MODELS } from "@/lib/ai/client";
import { assertUnderCap, recordUsage } from "@/lib/ai/usage";

export type TriageCategory =
  | "new_lead"
  | "booking"
  | "existing_client"
  | "faq"
  | "sensitive"
  | "spam"
  | "other";

export type TriagePriority = "high" | "normal" | "low";

const CATEGORIES: TriageCategory[] = [
  "new_lead",
  "booking",
  "existing_client",
  "faq",
  "sensitive",
  "spam",
  "other",
];

export interface TriageHistoryItem {
  direction: "inbound" | "outbound" | "note";
  content: string;
}

export interface TriageInput {
  messageText: string;
  channel: string;
  isExistingClient: boolean;
  senderName?: string | null;
  history?: TriageHistoryItem[];
  /** The real current tenant — required so the €25/month AI cap is checked and metered against the right gym. */
  tenantId: number;
}

export interface TriageResult {
  category: TriageCategory;
  priority: TriagePriority;
  tags: string[];
  summary: string;
  confidence: number;
  sensitive: boolean;
  /** Whether the model judged this safe to auto-reply (still re-checked by the pipeline). */
  autoReplyEligible: boolean;
  suggestedReply: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

const CATEGORY_GUIDE = `- new_lead: a prospective customer making first contact or asking about starting/trying a service. Not yet a client.
- booking: wants to book, reschedule, confirm, or cancel an appointment. (Never confirm a specific time yourself — the operator checks the schedule.)
- existing_client: a message from a known current/past client about their care, sessions, or account. You are told if the sender matches a client.
- faq: a general information question answerable from the business facts (hours, price, location, parking, what a service is).
- sensitive: medical/health-condition questions, complaints, distress, disputes, refunds. Always held for a human.
- spam: irrelevant, promotional, or junk.
- other: anything that doesn't fit the above.`;

function buildSystemPrompt(coreTags: string[]): string {
  return [
    `You are the message-triage assistant for ${getBusinessName()}. You read each inbound customer message and classify it for a busy operator's inbox.`,
    "",
    "=== BUSINESS FACTS (your ONLY source of truth) ===",
    getInboxBusinessFacts(),
    "",
    "=== CATEGORIES ===",
    CATEGORY_GUIDE,
    "",
    "=== TAGS ===",
    `Apply tags from this controlled list where they fit: ${coreTags.join(", ") || "(none defined)"}.`,
    "You may also suggest a NEW short tag (lowercase, one or two words) when clearly useful, but keep tags minimal — at most three per message.",
    "",
    "=== PRIORITY ===",
    "high = urgent, time-sensitive, a hot lead, upset, or a complaint. normal = a standard enquiry or booking. low = FYI, spam, or vague.",
    "",
    "=== SENSITIVE ===",
    "Set sensitive=true for anything medical, health-condition-specific, a complaint, distress, legal, or a refund/cancellation dispute. Sensitive messages must NEVER be auto-replied.",
    "",
    "=== SUGGESTED REPLY ===",
    "Draft a reply the operator can send. Plain text, Irish English (analyse, organise), warm and professional, under 90 words, no markdown or emojis. NEVER make medical or therapeutic claims or promise outcomes. State ONLY facts present in the BUSINESS FACTS above. If the answer is not in those facts, do not invent it — write a brief holding reply (e.g. 'let me check and come back to you') and lower your confidence.",
    "",
    "=== CONFIDENCE & AUTO-REPLY ===",
    "confidence (0-1) reflects BOTH your certainty of the category AND that the suggested reply is fully grounded and safe to send unedited.",
    "autoReplyEligible = true ONLY if category is 'faq' or 'new_lead', sensitive is false, and you are confident the reply is fully grounded and safe. Otherwise false.",
  ].join("\n");
}

function buildUserPrompt(input: TriageInput): string {
  const lines: string[] = [];
  lines.push(`Channel: ${input.channel}`);
  lines.push(
    `Sender is a known existing client: ${input.isExistingClient ? "yes" : "no"}`,
  );
  if (input.senderName) lines.push(`Sender name: ${input.senderName}`);
  if (input.history && input.history.length > 0) {
    lines.push("", "Recent conversation (oldest first):");
    for (const m of input.history.slice(-6)) {
      const who =
        m.direction === "inbound"
          ? "Them"
          : m.direction === "outbound"
            ? "Us"
            : "Note";
      lines.push(`${who}: ${m.content}`);
    }
  }
  lines.push("", "New inbound message to triage:", input.messageText);
  return lines.join("\n");
}

const TRIAGE_TOOL: Anthropic.Tool = {
  name: "record_triage",
  description: "Record the triage classification for the inbound message.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES },
      priority: { type: "string", enum: ["high", "normal", "low"] },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Lowercase tag labels; prefer the controlled list. Max 3.",
      },
      summary: {
        type: "string",
        description: "One concise sentence summarising the message.",
      },
      sensitive: { type: "boolean" },
      confidence: { type: "number", description: "0-1, per the rules." },
      suggestedReply: {
        type: "string",
        description: "Draft reply text, or empty string if none.",
      },
      autoReplyEligible: { type: "boolean" },
    },
    required: [
      "category",
      "priority",
      "tags",
      "summary",
      "sensitive",
      "confidence",
      "autoReplyEligible",
    ],
  },
};

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Read an inbound message and classify it. One Claude call, structured output
 * via forced tool-use. The system prompt (business facts + rules + tag vocab)
 * is stable across messages, so it's cached — only the per-message content is
 * uncached, keeping cost low (mirrors the draftFollowup caching strategy).
 */
export async function triageMessage(
  input: TriageInput,
): Promise<TriageResult> {
  // Checked first — see the matching comment on draftFollowup for why this
  // runs before the API-key guard below.
  assertUnderCap(input.tenantId);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local in the app/ folder.",
    );
  }

  const coreTags = db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.isCore, true))
    .all()
    .map((t) => t.label);

  const client = new Anthropic();
  const message = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(coreTags),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: "record_triage" },
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "record_triage",
  );
  if (!toolUse) {
    throw new Error("Triage model did not return a record_triage tool call");
  }

  const raw = toolUse.input as Record<string, unknown>;
  const category = (
    CATEGORIES.includes(raw.category as TriageCategory)
      ? raw.category
      : "other"
  ) as TriageCategory;
  const priority = (
    ["high", "normal", "low"].includes(raw.priority as string)
      ? raw.priority
      : "normal"
  ) as TriagePriority;
  const tags = Array.isArray(raw.tags)
    ? [
        ...new Set(
          raw.tags
            .map((t) => String(t).trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 3),
        ),
      ]
    : [];
  const sensitive = Boolean(raw.sensitive);
  const reply =
    typeof raw.suggestedReply === "string" ? raw.suggestedReply.trim() : "";

  recordUsage(input.tenantId, "triage", MODELS.opus, {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreateTokens: message.usage.cache_creation_input_tokens ?? 0,
  });

  return {
    category,
    priority,
    tags,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    confidence: clamp01(raw.confidence),
    sensitive,
    // The model's own judgement; the pipeline re-applies the hard gate.
    autoReplyEligible: Boolean(raw.autoReplyEligible) && !sensitive,
    suggestedReply: reply.length > 0 ? reply : null,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}
