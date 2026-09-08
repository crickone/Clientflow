import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext, getSignoffRule } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate, type MeterContext } from "@/lib/ai/metered";
import {
  generateCarouselSlides,
  type GenerateInput,
  type GenerateResult,
} from "@/lib/ai/generateCarousel";
import { getDesignSystem } from "@/lib/design/system";
import { valueHex, type DesignSystem } from "@/lib/design/parse";
import {
  GRAMMAR_RULES,
  accentHexFor,
  checkSlides,
  describeDesignSystem,
  extractComposedPayload,
  type ComposeCarouselResult,
} from "@/lib/ai/composeDesign.parse";

// Re-exported so callers have one import for the whole pass; the split exists
// only so the pure half can be tested without the server-only chain.
export {
  checkSlides,
  describeDesignSystem,
  extractComposedPayload,
} from "@/lib/ai/composeDesign.parse";
export type {
  ComposeCarouselResult,
  ComposeResult,
  ComposedSlide,
  FellThroughResult,
  RawSlide,
} from "@/lib/ai/composeDesign.parse";

/**
 * The generation pass for AI-composed slides.
 *
 * The model gets the tenant's own design system as structured context and the
 * archetype list as its vocabulary, and returns copy AND a layout per slide.
 * Everything it returns is parsed against the grammar and checked against the
 * system's measured rules; what fails goes back in EXACTLY ONE repair call
 * naming the violations. What survives that is persisted WITH its violations
 * recorded, because a failing slide is shown flagged, never swapped for a
 * fixed template and never hidden.
 *
 * A tenant with no design system falls through to today's generator
 * unchanged. That is the whole compatibility story: Inspire and Renova keep
 * the behaviour they have.
 */

// -------------------------------------------------------------------------
//  composeCarousel
// -------------------------------------------------------------------------

function buildUserPrompt(input: GenerateInput, system: DesignSystem): string {
  const lines: string[] = [];
  lines.push(`Topic: ${input.topic}`);
  lines.push(`Slides: ${input.slideCount}`);
  if (input.tone) lines.push(`Tone: ${input.tone}`);
  lines.push("");
  lines.push(
    `Compose ${input.slideCount} slides. Vary the grounds across the set within the budgets above, and vary the archetypes — a set where every slide is the same shape reads as a template, which is exactly what this system exists to avoid.`,
  );
  lines.push(
    `Return ONLY the JSON in <slides>...</slides>. Every layout is checked against this brand's ${system.rules.minContrastBody}:1 contrast floor and its ground rotation before anyone sees it.`,
  );
  return lines.join("\n");
}

export async function composeCarousel(
  input: GenerateInput,
  meter: MeterContext,
  model: string = CONTENT_MODEL,
): Promise<ComposeCarouselResult> {
  const system = getDesignSystem();

  // No design system: today's behaviour, exactly. Not a degraded version of
  // this one — the same call, the same result shape.
  if (!system) {
    const result = await generateCarouselSlides(input, meter, model);
    return { composed: false, ...result };
  }

  if (input.slideCount < 2 || input.slideCount > 10) {
    throw new Error("Slide count must be between 2 and 10.");
  }

  const systemPrompt = [
    getBusinessContext(),
    describeDesignSystem(system),
    GRAMMAR_RULES,
    getSignoffRule("social"),
  ].join("\n\n");

  /**
 * Output ceiling for the composed pass.
 *
 * NOT the 4096 the copy-only generator uses. A composed reply carries a full
 * layout spec per slide -- archetype, ground, photo treatment, and every text
 * slot with its level and span -- on top of the copy and the caption, and
 * adaptive thinking spends from the same output budget. At 4096 a five-slide
 * carousel truncates mid-JSON: the closing </slides> never arrives, the payload
 * will not parse, and the operator gets a generation that produced nothing.
 * That happened in production on the second real run.
 *
 * 16000 is the documented default for a non-streaming request -- high enough
 * that the model is not the binding constraint, low enough to stay under the
 * SDK's HTTP timeout. Output tokens are billed as used, so the headroom is
 * free unless it is needed.
 */
const COMPOSE_MAX_TOKENS = 16000;

const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  const addUsage = (m: Anthropic.Message) => {
    usage.inputTokens += m.usage.input_tokens;
    usage.outputTokens += m.usage.output_tokens;
    usage.cacheCreationInputTokens += m.usage.cache_creation_input_tokens ?? 0;
    usage.cacheReadInputTokens += m.usage.cache_read_input_tokens ?? 0;
  };
  const textOf = (m: Anthropic.Message) =>
    m.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

  const accentColor =
    accentHexFor(system) ??
    valueHex(system, system.grounds[0]?.value ?? "") ??
    "#000000";

  const userPrompt = buildUserPrompt(input, system);

  const first = await meteredCreate(meter, () => ({
    model,
    max_tokens: COMPOSE_MAX_TOKENS,
    thinking: { type: "adaptive" as const },
    system: [
      {
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [{ role: "user" as const, content: userPrompt }],
  }));
  addUsage(first);

  const firstText = textOf(first);
  if (first.stop_reason === "max_tokens") {
    throw new Error(
      `The design ran out of room before it finished (${input.slideCount} slides). Try fewer slides, or a shorter topic.`,
    );
  }
  const payload = extractComposedPayload(firstText);
  let checked = checkSlides(payload.slides, system, accentColor);
  let caption = payload.caption;
  let repaired = false;

  // EXACTLY ONE repair call. Not a loop: a model that cannot satisfy the
  // grammar twice will not satisfy it on the fifth attempt either, and the
  // operator would be paying for the attempts. What survives is shown flagged.
  if (checked.problems.length > 0) {
    repaired = true;
    const repair = await meteredCreate(meter, () => ({
      model,
      max_tokens: COMPOSE_MAX_TOKENS,
      thinking: { type: "adaptive" as const },
      system: [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [
        { role: "user" as const, content: userPrompt },
        { role: "assistant" as const, content: firstText },
        {
          role: "user" as const,
          content: `These layouts break the brand's own rules:\n\n${checked.problems.map((p) => `- ${p}`).join("\n")}\n\nReturn the WHOLE carousel again, corrected, in the same format. Keep everything that was not named above — the copy, the archetypes and the grounds that passed. Fix only what is listed.`,
        },
      ],
    }));
    addUsage(repair);

    try {
      const second = extractComposedPayload(textOf(repair));
      const recheck = checkSlides(second.slides, system, accentColor);
      // Take the repair only if it is actually better. A repair that returns
      // fewer slides, or more violations, is a regression — keep the first.
      if (
        recheck.slides.length >= checked.slides.length &&
        recheck.problems.length < checked.problems.length
      ) {
        checked = recheck;
        caption = second.caption || caption;
      }
    } catch {
      // A repair that does not parse leaves the first attempt standing.
    }
  }

  return {
    composed: true,
    slides: checked.slides,
    caption,
    setViolations: checked.setViolations,
    repaired,
    usage,
  };
}
