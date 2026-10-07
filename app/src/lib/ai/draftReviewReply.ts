import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext } from "@/lib/ai/businessContext";
import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";

/**
 * A public reply to a Google review, in the business's voice, for the
 * operator to edit and post. Public, permanent and read by future customers,
 * so the rules lean careful.
 */
const RULES = `Your job: draft the business's PUBLIC reply to a Google review, for a staff member to review before posting.

Rules:
- Plain text. No markdown, no emojis, no hashtags.
- Short: 25 to 70 words.
- Thank them by first name when the reviewer's name looks like a real name; otherwise just thank them.
- Refer to something specific they said, so it does not read as a template.
- A positive review: thank them warmly and invite them back. Do not oversell.
- A mixed or negative review: acknowledge it plainly, apologise for their experience without admitting fault or liability, never argue, and invite them to contact the business directly (use the phone number from the business details if there is one). Do not discuss health conditions, treatments or outcomes in public.
- Never offer discounts, refunds, freebies or incentives. Never ask for a better rating. Never promise results.
- State only facts present in the business details above.
- Irish English. Sign off with the business name on its own line.

Output: ONLY the reply text.`;

export async function draftReviewReply(input: {
  tenantId: number;
  reviewer: string;
  rating: number;
  comment: string;
}): Promise<string> {
  const message = await meteredCreate({ tenantId: input.tenantId, agentKey: "inbox" }, () => ({
    model: MODELS.opus,
    // Public and permanent, so `medium` effort; thinking counts against max_tokens.
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: `${getBusinessContext()}\n\n${RULES}`, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Reviewer: ${input.reviewer}\nRating: ${input.rating} out of 5\nReview: ${input.comment || "(no written comment, rating only)"}\n\nDraft the reply.`,
      },
    ],
  }));
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
