import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import { parseMealReading, type MealReading } from "@/lib/mealsModel";

/**
 * Read a client's photo of a meal or a food label into calories and macros.
 * A plate is estimated from what's visible and typical portion sizes; a label
 * is read as printed, per serving. Metered against the business's AI
 * allowance under "meals". Returns null when the photo isn't food.
 */
const RULES = `You read a photo a client took in a gym or clinic's app and return what they ate as JSON.

Decide which it is:
- "label": a food package or its nutrition table is visible. Read the printed values PER SERVING (not per 100 g unless that's the only figure, then say so in notes). Put the serving size in "serving" ("1 bar (55 g)", "30 g"). items may be empty. Confidence "high" when the table is readable.
- "meal": a plate, bowl, drink or snack. Name each visible food in "items" with how much of it there is in words the client can check against the plate ("portion": "1 breast, palm-sized", "a cupped handful", "2 slices", "about a third of the plate"), the estimated grams, and its calories, protein, carbs and fat. Use what's visible for scale: plate size (a dinner plate is about 26 cm), cutlery, a hand, the packaging. Irish and UK foods and brands are common (Brennans bread, Avonmore milk, Fulfil bars, a chicken fillet roll, a full Irish). Totals are the sum of the items. Confidence "medium" for a normal plate, "low" when portions are hidden (a sauce, a wrap, a stew).

"notes" is how you worked it out, so the client can judge it: what gave you the scale, which portions you're least sure of, and anything you assumed (oil in the pan, full-fat milk). Two or three short plain sentences.
- Not food at all: return {"food": false, "notes": "<what it is>"}.

Numbers are whole numbers in kcal and grams. Never add foods you can't see. If the client wrote a note, trust it over your guess (e.g. "two slices", "no butter", "half the bar").

Return ONLY this JSON, no code fence, no preamble:
{"kind":"meal"|"label","name":"short name of the meal or product","items":[{"name":"","portion":"how much, in words","grams":null|number,"calories":0,"protein":0,"carbs":0,"fat":0}],"calories":0,"protein":0,"carbs":0,"fat":0,"serving":null|"","confidence":"high"|"medium"|"low","notes":"how you worked it out"}`;

export async function readMeal(input: {
  tenantId: number;
  bytes: Buffer;
  mime: "image/jpeg" | "image/png" | "image/webp";
  note?: string | null;
}): Promise<MealReading | null> {
  const note = (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const message = await meteredCreate({ tenantId: input.tenantId, agentKey: "meals" }, () => ({
    model: MODELS.sonnet,
    // A number the client will act on, so `medium`, stated: Opus/Sonnet 5.5
    // default to medium but a silent default is not a decision. Thinking
    // counts against max_tokens.
    max_tokens: 2500,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: input.mime, data: input.bytes.toString("base64") } },
          { type: "text", text: note ? `The client's note: ${note}` : "No note from the client." },
        ],
      },
    ],
  }));
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return parseMealReading(text);
}
