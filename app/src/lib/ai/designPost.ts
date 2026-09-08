import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext, getSignoffRule } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import {
  DESIGN_RULES,
  NO_PHOTOGRAPHY_RULE,
  PHOTO_TOKEN,
  checkDesigns,
  describeSystemForDesign,
  extractDesignPayload,
  type CheckedDesign,
  type RawDesign,
} from "@/lib/ai/designPost.parse";
import {
  generateCarouselSlides,
  type GenerateInput,
  type GenerateResult,
} from "@/lib/ai/generateCarousel";
import { meteredCreateStreamed, type MeterContext } from "@/lib/ai/metered";
import { loadDesignFonts } from "@/lib/design/fonts";
import { gradedPhotoDataUri, renderDesignToPng } from "@/lib/design/renderDesign";
import { getDesignSystem } from "@/lib/design/system";
import type { DesignSystem } from "@/lib/design/parse";
import { saveRender } from "@/lib/image/renderStore";

/**
 * The design pass: the model authors the post, this renders it.
 *
 * A tenant with no design system falls through to today's generator unchanged.
 * That is the whole compatibility story -- Inspire and Renova keep exactly the
 * behaviour they have, because a design system is the only thing that makes
 * "design it yourself" safe to ask for.
 */

/**
 * An HTML design per slide is the largest payload this app asks a model for,
 * and adaptive thinking spends from the same output budget. 4096 truncated the
 * far smaller archetype payload in production; this is not the place to be
 * frugal. Output tokens bill as used, so the headroom is free unless taken.
 */
const DESIGN_MAX_TOKENS = 32000;

/** Slide dimensions by aspect ratio. The canvas the model is told to fill. */
const CANVAS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

export interface DesignedSlide {
  /** The authored markup, with the photo placeholder still in it. Source of
   *  truth: the render is derived and can be rebuilt from this. */
  html: string;
  /** The stored PNG, or null when the markup would not render. */
  renderFilename: string | null;
  photo: string;
  violations: string[];
}

export interface DesignPostResult {
  designed: true;
  slides: DesignedSlide[];
  caption: string;
  repaired: boolean;
  usage: GenerateResult["usage"];
}

export interface FellThroughResult extends GenerateResult {
  designed: false;
}

export type DesignPostOutcome = DesignPostResult | FellThroughResult;

/**
 * Render one design. Photo substitution happens here rather than in the model's
 * markup because satori cannot fetch a URL and has no CSS filter: the image has
 * to arrive already graded, and inline.
 */
async function renderOne(
  design: CheckedDesign,
  system: DesignSystem,
  width: number,
  height: number,
  photoSource: Buffer | string | null,
): Promise<{ renderFilename: string | null; violation: string | null }> {
  let html = design.html;
  if (html.includes(PHOTO_TOKEN)) {
    if (photoSource) {
      const uri = await gradedPhotoDataUri(
        photoSource,
        width,
        height,
        system.photo,
      );
      html = html.split(PHOTO_TOKEN).join(uri);
    } else {
      // No photograph available. Strip the whole <img> rather than leave a
      // broken src, which satori would draw as an empty box.
      html = html.replace(/<img[^>]*\{\{PHOTO\}\}[^>]*>/gi, "");
    }
  }

  try {
    const fonts = await loadDesignFonts("Inter");
    const png = await renderDesignToPng(html, width, height, fonts);
    return { renderFilename: saveRender(png), violation: null };
  } catch (err) {
    // A design that will not render must not take the whole set down with it.
    // The slide is kept, flagged with the renderer's own words, and the
    // operator can regenerate just that one.
    const message = err instanceof Error ? err.message : String(err);
    return {
      renderFilename: null,
      violation: `This design could not be rendered: ${message}`,
    };
  }
}

export async function designPost(
  input: GenerateInput,
  meter: MeterContext,
  model: string = CONTENT_MODEL,
  options: {
    aspectRatio?: "1:1" | "4:5" | "9:16";
    /** Source image for slides that ask for a photograph. */
    photoSource?: Buffer | string | null;
  } = {},
): Promise<DesignPostOutcome> {
  const system = getDesignSystem();
  if (!system) {
    const result = await generateCarouselSlides(input, meter, model);
    return { designed: false, ...result };
  }

  if (input.slideCount < 1 || input.slideCount > 10) {
    throw new Error("Slide count must be between 1 and 10.");
  }

  const { width, height } = CANVAS[options.aspectRatio ?? "1:1"] ?? CANVAS["1:1"];

  // Whether photography exists changes what the model should design, not just
  // what it gets. Offering a photograph that will then be stripped leaves the
  // scrim built for it lying on a flat ground.
  const hasPhotography = !!options.photoSource;

  const systemPrompt = [
    getBusinessContext(),
    describeSystemForDesign(system),
    DESIGN_RULES,
    hasPhotography ? null : NO_PHOTOGRAPHY_RULE,
    getSignoffRule("social"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = [
    `Topic: ${input.topic}`,
    `Slides: ${input.slideCount}`,
    input.tone ? `Tone: ${input.tone}` : null,
    "",
    `The canvas for every slide is EXACTLY ${width}x${height} pixels.`,
    `Design ${input.slideCount} slide${input.slideCount === 1 ? "" : "s"} as ONE set: different compositions, one visual world. Rotate the grounds within the budgets above.`,
    "Return ONLY the JSON in <design>...</design>.",
  ]
    .filter(Boolean)
    .join("\n");

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

  // Streamed, not because the output is shown live but because the SDK refuses
  // a non-streaming request at this max_tokens: it could outrun the 10-minute
  // HTTP limit. finalMessage() hands back one finished Message, so everything
  // downstream is unchanged.
  const ask = (messages: Anthropic.MessageParam[]) =>
    meteredCreateStreamed(meter, () => ({
      model,
      max_tokens: DESIGN_MAX_TOKENS,
      thinking: { type: "adaptive" as const },
      system: [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages,
    }));

  const first = await ask([{ role: "user", content: userPrompt }]);
  addUsage(first);
  if (first.stop_reason === "max_tokens") {
    throw new Error(
      `The design ran out of room before it finished (${input.slideCount} slides). Try fewer slides, or a shorter topic.`,
    );
  }

  /**
   * Audit AND RENDER a set, so `problems` carries everything the repair call
   * could fix.
   *
   * Rendering before the repair decision is the whole point. The audit reads
   * markup and cannot know that satori will reject a container missing
   * display:flex -- only the renderer knows that, and on the first real
   * generation three of four slides failed exactly that way with no chance to
   * be repaired, because rendering happened after the repair opportunity had
   * passed. Rendering is local and fast; a wasted render costs far less than a
   * slide the operator has to regenerate by hand.
   */
  async function attempt(slides: RawDesign[]) {
    const checked = checkDesigns(slides, system!);
    const problems = [...checked.problems];
    const rendered: DesignedSlide[] = [];
    for (let i = 0; i < checked.designs.length; i++) {
      const design = checked.designs[i];
      const { renderFilename, violation } = await renderOne(
        design,
        system!,
        width,
        height,
        options.photoSource ?? null,
      );
      if (violation) problems.push(`Slide ${i + 1}: ${violation}`);
      rendered.push({
        html: design.html,
        renderFilename,
        photo: design.photo,
        violations: violation
          ? [...design.violations, violation]
          : design.violations,
      });
    }
    return { slides: rendered, problems };
  }

  const firstText = textOf(first);
  const payload = extractDesignPayload(firstText);
  let checked = await attempt(payload.slides);
  let caption = payload.caption;
  let repaired = false;

  // EXACTLY ONE repair call. A model that cannot satisfy the constraints twice
  // will not satisfy them on the fifth attempt either, and the operator pays
  // for every attempt. What survives is shown flagged.
  if (checked.problems.length > 0) {
    repaired = true;
    const repair = await ask([
      { role: "user", content: userPrompt },
      { role: "assistant", content: firstText },
      {
        role: "user",
        content: `These designs break the brand's own rules or will not render:\n\n${checked.problems
          .map((p) => `- ${p}`)
          .join(
            "\n",
          )}\n\nReturn the WHOLE post again, corrected, in the same format. Keep everything that was not named above. Fix only what is listed.`,
      },
    ]);
    addUsage(repair);
    try {
      const second = extractDesignPayload(textOf(repair));
      const recheck = await attempt(second.slides);
      // Take the repair only if it is actually better. One that returns fewer
      // slides, or more problems, is a regression -- keep the first.
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

  return { designed: true, slides: checked.slides, caption, repaired, usage };
}

/**
 * Redesign ONE slide.
 *
 * This is the whole editing model for a designed slide. There are no inspector
 * controls because there is no fixed slot for them to point at -- the AI
 * decided where the heading goes -- so an operator accepts what they see,
 * regenerates it, or nudges it with a sentence ("make the headline bigger",
 * "try it on the dark ground").
 *
 * The previous markup goes back in as the assistant's turn, so a nudge is a
 * revision of THIS design rather than a fresh attempt at the topic: "bigger"
 * has no meaning without the thing it is bigger than.
 */
export async function redesignSlide(
  input: {
    topic: string;
    /** The markup being revised. */
    previousHtml: string;
    /** The operator's instruction, or null for a plain regenerate. */
    note: string | null;
    aspectRatio?: "1:1" | "4:5" | "9:16";
    photoSource?: Buffer | string | null;
  },
  meter: MeterContext,
  model: string = CONTENT_MODEL,
): Promise<{ slide: DesignedSlide; usage: GenerateResult["usage"] } | null> {
  const system = getDesignSystem();
  if (!system) return null;

  const { width, height } = CANVAS[input.aspectRatio ?? "1:1"] ?? CANVAS["1:1"];
  const hasPhotography = !!input.photoSource;

  const systemPrompt = [
    getBusinessContext(),
    describeSystemForDesign(system),
    DESIGN_RULES,
    hasPhotography ? null : NO_PHOTOGRAPHY_RULE,
    getSignoffRule("social"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const askFor = `Topic: ${input.topic}\n\nDesign ONE slide on a ${width}x${height} canvas. Return ONLY the JSON in <design>...</design>, with exactly one entry in "slides".`;

  const message = await meteredCreateStreamed(meter, () => ({
    model,
    max_tokens: DESIGN_MAX_TOKENS,
    thinking: { type: "adaptive" as const },
    system: [
      {
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [
      { role: "user" as const, content: askFor },
      {
        role: "assistant" as const,
        content: `<design>\n${JSON.stringify({ caption: "", slides: [{ photo: "", html: input.previousHtml }] })}\n</design>`,
      },
      {
        role: "user" as const,
        content: input.note?.trim()
          ? `${input.note.trim()}\n\nRedesign that slide accordingly. Keep everything the instruction does not touch. Same format.`
          : "Design that slide again, differently. Same content, a different composition. Same format.",
      },
    ],
  }));

  if (message.stop_reason === "max_tokens") {
    throw new Error("The design ran out of room before it finished. Try a shorter note.");
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const payload = extractDesignPayload(text);
  const first = payload.slides[0];
  if (!first) throw new Error("The designer returned no slide.");

  const checked = checkDesigns([first], system);
  const design = checked.designs[0];
  const { renderFilename, violation } = await renderOne(
    design,
    system,
    width,
    height,
    input.photoSource ?? null,
  );

  return {
    slide: {
      html: design.html,
      renderFilename,
      photo: design.photo,
      violations: violation
        ? [...design.violations, violation]
        : design.violations,
    },
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}
