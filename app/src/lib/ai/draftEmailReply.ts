import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext } from "@/lib/ai/businessContext";
import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";

/**
 * A reply to an email thread, in the business's voice, for the operator to
 * edit and send. Never sent from here: the inbox puts it in the reply box.
 */
const RULES = `Your job: draft a reply to the email thread below, written as the business, for a staff member to review before sending.

Voice and constraints:
- Plain text only. No markdown, no emojis.
- Short: under 120 words unless the email asks several questions.
- Answer what they actually asked. Irish English (organise, analyse).
- State only facts present in the business details above. If the answer is not there, write a brief holding line ("let me check and come back to you") instead of inventing it.
- Never make medical or therapeutic claims or promise outcomes. No pricing, no free consultations, no money-back guarantees unless the business details above state them.
- Greet them by first name when it is known. End with the sign-off placeholder on its own line: "[Your name]".

Output:
- Return ONLY the reply text. No preamble, no subject line.`;

export type EmailForDraft = { direction: "in" | "out"; from: string; text: string; at: number | null };

function buildUserPrompt(subject: string, messages: EmailForDraft[]): string {
  const lines = [`Subject: ${subject || "(no subject)"}`, "", "Thread (oldest first):"];
  for (const m of messages.slice(-6)) {
    lines.push("", `${m.direction === "in" ? `Them (${m.from})` : "Us"}:`, m.text.slice(0, 2500));
  }
  lines.push("", "Draft our reply to the latest message from them.");
  return lines.join("\n");
}

export async function draftEmailReply(input: {
  tenantId: number;
  subject: string;
  messages: EmailForDraft[];
}): Promise<string> {
  const message = await meteredCreate({ tenantId: input.tenantId, agentKey: "inbox" }, () => ({
    model: MODELS.opus,
    // Goes out under the business's name, so `medium`, stated because Opus
    // 5.5's default is not a decision. Thinking counts against max_tokens.
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: `${getBusinessContext()}\n\n${RULES}`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserPrompt(input.subject, input.messages) }],
  }));
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
