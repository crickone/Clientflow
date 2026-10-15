import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import { parseMealItem, type MealItem } from "@/lib/mealsModel";

/**
 * Price one food the client describes in words ("a tablespoon of pumpkin
 * seeds", "honey drizzled on top"), to add to a meal the photo reader missed.
 * Text only, so quick and under a cent. Metered under "meals". Null when it
 * isn't food.
 */
const RULES = `A client of a gym or clinic is correcting a logged meal: they name something the photo reader missed, in their own words. Return that ONE item as JSON with a sensible portion.

- Take the amount from their words ("a tablespoon", "two slices", "a handful", "a splash"). If they give no amount, use a typical single portion and say so in "portion".
- Irish and UK foods and brands are common. Use typical nutrition values per 100 g scaled to the portion.
- Whole numbers in kcal and grams. "grams" is your best estimate of the weight; null only for a drink you can't weigh.
- If it isn't food or drink, return {"food": false}.

Return ONLY this JSON, no code fence, no preamble:
{"name":"short name","portion":"the amount in words","grams":number|null,"calories":0,"protein":0,"carbs":0,"fat":0}`;

export async function priceItem(input: { tenantId: number; text: string; mealName?: string | null }): Promise<MealItem | null> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text) return null;
  const message = await meteredCreate({ tenantId: input.tenantId, agentKey: "meals" }, () => ({
    model: MODELS.sonnet,
    // A small, well-defined task: `low`, stated (Sonnet 5.5's default is
    // medium). Thinking counts against max_tokens.
    max_tokens: 800,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${input.mealName ? `The meal: ${input.mealName}. ` : ""}They added: ${text}` }],
  }));
  const out = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return parseMealItem(out);
}
