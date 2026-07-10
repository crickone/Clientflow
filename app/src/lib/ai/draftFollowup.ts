import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Lead, LeadMessage } from "@/lib/db/schema";
import { getBusinessContext } from "@/lib/ai/businessContext";

/**
 * Follow-up writing rules. The business identity, services and voice/marketing
 * brain are supplied per-account by getBusinessContext() and prepended at call
 * time — so a gym's leads get gym messaging, not the wellness-clinic baseline.
 */
const FOLLOWUP_RULES = `Your job: write short, warm follow-up messages to people who submitted a lead form expressing interest, and convert them into bookings.

Voice and constraints:
- Plain text only. No markdown, no emojis, no formatting.
- Keep messages under 80 words.
- Be warm and personal but professional. First name only when greeting.
- One clear call-to-action: ask if they'd like to book in, and offer 2-3 example times OR direct them to call/email to choose a time. Don't be pushy.
- Reference the specific service/class they showed interest in (only from the services listed above — never invent one).
- Never make medical or therapeutic claims or promise outcomes. Describe what the service/class is, not what it cures.
- If they mentioned a specific concern in the lead form, gently acknowledge it without guarantees ("many people with similar goals have found it helpful").
- End with the signoff as a placeholder on its own line: "— [Business name]". The operator will personalise it.
- Do not put the address, phone or website in the message body.

Output:
- Return ONLY the message text. No preamble, no explanation — just the message body.`;

/**
 * The system prompt is stable per account (identity + services + marketing
 * brain + the rules above), so it's marked ephemeral and cache-read cheaply on
 * repeat drafts. It changes only when the business profile/services change.
 */
function buildSystemPrompt(): string {
  return `${getBusinessContext()}\n\n${FOLLOWUP_RULES}`;
}

export interface DraftInput {
  lead: Lead;
  history: LeadMessage[];
}

export interface DraftResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

/**
 * Build the per-lead user message. Stable parts of the prompt live in the
 * system block (cached); only the lead-specific context goes here.
 */
function buildUserPrompt(lead: Lead, history: LeadMessage[]): string {
  const lines: string[] = [];
  lines.push("Lead details:");
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  lines.push(`- Name: ${name || "(not provided)"}`);
  lines.push(`- Therapy interest: ${lead.therapyInterest || "(not specified)"}`);
  if (lead.campaign) lines.push(`- Source campaign: ${lead.campaign}`);
  if (lead.email) lines.push(`- Email: ${lead.email}`);
  if (lead.phone) lines.push(`- Phone: ${lead.phone}`);
  if (lead.notes) lines.push(`- Notes from form: ${lead.notes}`);
  lines.push(`- Submitted: ${lead.createdAt.toISOString().slice(0, 10)}`);

  if (history.length > 0) {
    lines.push("");
    lines.push("Conversation so far:");
    for (const m of history) {
      const tag =
        m.direction === "outbound"
          ? `Us (${m.channel ?? "manual"})`
          : m.direction === "inbound"
            ? `Lead (${m.channel ?? "unknown"})`
            : "Note";
      lines.push(`${tag}: ${m.content}`);
    }
    lines.push("");
    lines.push(
      "Draft the next outbound message. If the lead has replied, respond to what they said. If they haven't replied, write a gentle follow-up — be more concise than a first message and don't repeat yourself.",
    );
  } else {
    lines.push("");
    lines.push(
      "This is the first contact. Draft a warm intro message to convert this lead into a booking.",
    );
  }
  return lines.join("\n");
}

export async function draftFollowup({
  lead,
  history,
}: DraftInput): Promise<DraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local in the app/ folder.",
    );
  }

  const client = new Anthropic();

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 512,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildUserPrompt(lead, history),
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    text,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}
