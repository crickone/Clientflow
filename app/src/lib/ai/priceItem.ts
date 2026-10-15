import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import { parseMealItems, type MealItem } from "@/lib/mealsModel";
import { RAW_INGREDIENT_RULE } from "@/lib/ai/readMeal";

/**
 * Price food the client describes in words ("a tablespoon of pumpkin seeds",
 * "overnight oats with flax and chia"), to add to a meal the photo reader
 * missed. A mixed food comes back as its raw ingredients, one line each.
 * Text only, so quick and under a cent. Metered under "meals". Empty when it
 * isn't food.
 */
const RULES = `A client of a gym or clinic is correcting a logged meal: they name something the photo reader missed, in their own words. Return it as JSON items with sensible amounts.

${RAW_INGREDIENT_RULE}
- Take the amounts from their words ("a tablespoon", "two slices", "a handful", "a splash"). If they give no amount, use a typical single portion and say so in "portion".
- Irish and UK foods and brands are common. Use typical nutrition values per 100 g scaled to the amount.
- Whole numbers in kcal and grams. "grams" is your best estimate of the weight; null only for a drink you can't weigh.
- If it isn't food or drink, return {"items": []}.

Return ONLY this JSON, no code fence, no preamble:
{"items":[{"name":"short name","portion":"the amount in words","grams":number|null,"calories":0,"protein":0,"carbs":0,"fat":0}]}`;

export async function priceItems(input: { tenantId: number; text: string; mealName?: string | null }): Promise<MealItem[]> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text) return [];
  return ask(input.tenantId, RULES, `${input.mealName ? `The meal: ${input.mealName}. ` : ""}They added: ${text}`, "low");
}

/**
 * Break one logged line ("Overnight oats / chia and flax base, 220 g") into
 * its raw ingredients with their own amounts, keeping the total close to what
 * was logged unless that was clearly wrong.
 */
const SPLIT_RULES = `A client logged a meal and one line combines several foods. Break that line into its raw ingredients, each with its own amount.

${RAW_INGREDIENT_RULE}
- The ingredients together should come to about the line's weight and calories, unless those were clearly wrong for what it is.
- If the line is a single food or a packaged product that can't be split, return it unchanged as one item.

Return ONLY this JSON, no code fence, no preamble:
{"items":[{"name":"short name","portion":"the amount in words","grams":number|null,"calories":0,"protein":0,"carbs":0,"fat":0}]}`;

export async function splitItem(input: { tenantId: number; item: MealItem; mealName?: string | null }): Promise<MealItem[]> {
  const it = input.item;
  const line = `${it.name}${it.portion ? ` (${it.portion})` : ""}: ${it.grams ?? "unknown"} g, ${it.calories} kcal, protein ${it.protein} g, carbs ${it.carbs} g, fat ${it.fat} g`;
  return ask(input.tenantId, SPLIT_RULES, `${input.mealName ? `The meal: ${input.mealName}. ` : ""}The line: ${line}`, "low");
}

async function ask(tenantId: number, system: string, user: string, effort: "low" | "medium"): Promise<MealItem[]> {
  const message = await meteredCreate({ tenantId, agentKey: "meals" }, () => ({
    model: MODELS.sonnet,
    // A small, well-defined task: the effort is stated (Sonnet 5.5's default
    // is medium). Thinking counts against max_tokens.
    max_tokens: 1500,
    thinking: { type: "adaptive" },
    output_config: { effort },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  }));
  const out = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return parseMealItems(out);
}
