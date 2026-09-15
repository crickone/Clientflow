import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext, getSignoffRule } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import {
  DESIGN_RULES,
  logoReserveRule,
  photographyRuleFor,
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
import { logoBox } from "@/lib/design/renderDesign";
import { MAX_PHOTO_SLOTS, photoSlotsUsed } from "@/lib/design/photoSlots";
import {
  canvasFor,
  overflowViolation,
  renderDesignedSlide,
} from "@/lib/design/renderDesignedSlide";
import { getDesignSystem } from "@/lib/design/system";
import { pickOpeningMove } from "@/lib/ai/openingMoves";
import { readKey, setKey } from "@/lib/settings";
import type { DesignSystem } from "@/lib/design/parse";

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

/** Settings key holding the opening move the LAST post used, so the next one can't repeat it. */
const LAST_OPENING_MOVE_KEY = "last_opening_move";

/**
 * One photograph the renderer may use, and the library row it came from.
 *
 * The id is carried so a finished slide can RECORD which photo it used. Without
 * it a re-render has to guess, and every designed slide in a set was in fact
 * handed the same guess -- `listLibraryAssets()[0]` -- which is why a set of
 * seven slides came back with one picture on all of them regardless of what
 * each slide had asked for.
 */
export interface PhotoChoice {
  /** The image-library asset, or null for a path with no row behind it. */
  id: number | null;
  path: string;
}

export interface DesignedSlide {
  /** The authored markup, with the photo placeholder still in it. Source of
   *  truth: the render is derived and can be rebuilt from this. */
  html: string;
  /** The stored PNG, or null when the markup would not render. */
  renderFilename: string | null;
  /** The scene the design asked for, in the designer's words. Kept so a slide
   *  can be re-photographed later against what it actually wanted. SLOT 1's
   *  scene, and photoScenes[0]. */
  photo: string;
  /** The scene per slot, index 0 being slot 1. Carried through because a
   *  two-photograph slide asks for two DIFFERENT pictures -- infrared above,
   *  HBOT below -- and briefing slot 2's regeneration with slot 1's scene is
   *  how the operator got a second infrared bed. */
  photoScenes: string[];
  /** The library asset slot 1's photograph came from, if it used one. Kept as
   *  the shorthand every reader that only cares about one photograph already
   *  uses (the routes, background_asset_id), and it is photoAssetIds[0]. */
  photoAssetId: number | null;
  /** The library asset per slot, index 0 being slot 1. Empty on a flat slide;
   *  one entry on the common one-photograph slide. */
  photoAssetIds: (number | null)[];
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
 * Render one design, in the generator's terms: a filename, or a violation the
 * repair call can act on.
 *
 * The recipe itself lives in lib/design/renderDesignedSlide -- three copies of
 * it had drifted apart. What is left here is the translation from "it
 * overflowed" / "it would not render" into the sentences this file feeds back
 * to the model, which is a generation concern and not a rendering one.
 */
async function renderOne(
  design: CheckedDesign,
  system: DesignSystem,
  aspectRatio: string,
  photos: (PhotoChoice | null)[],
  logoPath: string | null,
): Promise<{ renderFilename: string | null; violation: string | null }> {
  try {
    const render = await renderDesignedSlide({
      html: design.html,
      aspectRatio,
      photos,
      logoPath,
      system,
    });

    // Does the design actually FIT? satori has no auto-fit, so a slide with one
    // sentence too many renders with its last line sliced off at the canvas
    // edge -- and it renders "successfully", which is why this cannot be left
    // to the catch below. The render is still kept: a clipped slide the
    // operator can see beats no slide at all, and the violation puts it in
    // front of the repair call, which is the thing that can actually fix it.
    return {
      renderFilename: render.filename,
      violation:
        render.overflowPx > 0
          ? overflowViolation(render.overflowPx, render.width, render.height)
          : null,
    };
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

/**
 * Whether two slides were handed the same photographs, slot for slot. What the
 * reuse check above compares: identical markup on identical pictures paints
 * identical pixels, so the render can be carried over instead of redone. It was
 * a single `===` on one asset id, which could not tell "the same picture in
 * both slots" from "two different ones".
 */
function sameAssetIds(a: (number | null)[], b: (number | null)[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export async function designPost(
  input: GenerateInput,
  meter: MeterContext,
  model: string = CONTENT_MODEL,
  options: {
    aspectRatio?: "1:1" | "4:5" | "9:16";
    /**
     * Photographs available to slides that ask for one. Each slide that uses
     * the placeholder takes the NEXT entry, so a set moves through the library
     * instead of repeating one picture; the list cycles when there are more
     * photo slides than photos.
     */
    photos?: PhotoChoice[];
    /** The tenant's logo file, stamped onto every slide. Null to omit it. */
    logoPath?: string | null;
    /**
     * Called as the run moves through its stages, for a caller that has
     * somewhere to show them. A generation is two to four minutes and was
     * reported as a hang when it accounted for none of that.
     */
    onProgress?: (stage: string) => void;
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

  const aspectRatio = options.aspectRatio ?? "1:1";
  const { width, height } = canvasFor(aspectRatio);

  // Whether photography exists changes what the model should design, not just
  // what it gets. Offering a photograph that will then be stripped leaves the
  // scrim built for it lying on a flat ground.
  const photos = options.photos ?? [];
  const hasPhotography = photos.length > 0;
  const onProgress = options.onProgress;

  // Computed from the real logo file, not stated as a fraction: its height is
  // its own aspect ratio at the stamped width, which no fixed phrasing can
  // stand in for. See logoReserveRule.
  const reserve = options.logoPath ? await logoBox(options.logoPath, width) : null;

  const systemPrompt = [
    getBusinessContext(),
    describeSystemForDesign(system),
    DESIGN_RULES,
    logoReserveRule(reserve, width, height),
    // From the COUNT, not just "any at all": the rotation below hands the same
    // choice to both slots of a two-slot slide whenever the library holds one
    // photograph, so a library of one that was invited to design a comparison
    // produced the same picture twice. See photographyRuleFor.
    photographyRuleFor(photos.length),
    getSignoffRule("social"),
  ]
    .filter(Boolean)
    .join("\n\n");

  // A direction for slide one, rotated between generations. Without it the
  // model opens every post the same way -- the prompt is identical each time,
  // so it settles on its favourite composition and posts start to resemble
  // each other even though each SET is varied internally. See ./openingMoves
  // for why this is a direction rather than a layout to fill in.
  const lastMove = readKey<string | null>(LAST_OPENING_MOVE_KEY, null);
  const move = pickOpeningMove(lastMove, hasPhotography);
  setKey(LAST_OPENING_MOVE_KEY, move.key);

  const userPrompt = [
    `Topic: ${input.topic}`,
    `Slides: ${input.slideCount}`,
    input.tone ? `Tone: ${input.tone}` : null,
    "",
    `The canvas for every slide is EXACTLY ${width}x${height} pixels.`,
    `Design ${input.slideCount} slide${input.slideCount === 1 ? "" : "s"} as ONE set: different compositions, one visual world. Rotate the grounds within the budgets above.`,
    "",
    `THE OPENING SLIDE: open on ${move.directive}. That is a starting point, not a template -- compose it yourself, and let the slides after it move away from that shape.`,
    "",
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

  onProgress?.(`Designing ${input.slideCount} slides`);
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
  /**
   * `previous` is the attempt this one supersedes, when there is one. A repair
   * is asked to return the WHOLE post with only the named slides fixed, so most
   * of what comes back is byte-identical to what was already rendered -- and
   * rendering a slide is TWO satori passes (the render, then the overflow
   * measurement). Reusing the render for markup that did not change is the
   * difference between a repair costing one slide's work and costing the set's,
   * which an operator felt directly: "it got there in the end, just really
   * slow".
   */
  async function attempt(slides: RawDesign[], previous?: DesignedSlide[]) {
    const checked = checkDesigns(slides, system!);
    const problems = [...checked.problems];
    const rendered: DesignedSlide[] = [];
    const unchanged = new Map(
      (previous ?? [])
        .filter((p) => p.renderFilename)
        .map((p) => [p.html, p] as const),
    );
    // Advanced only by slots that actually take a photograph, so two photo
    // slides never land on the same picture just because a flat slide sat
    // between them. It now advances per SLOT rather than per slide, which is
    // the same rule applied one level down: a slide asking for two pictures
    // takes the next two, so a comparison shows two things rather than one
    // thing twice.
    let nextPhoto = 0;
    for (let i = 0; i < checked.designs.length; i++) {
      const design = checked.designs[i];
      // Slots past the cap are left unassigned deliberately: the audit has
      // already flagged them as unfillable, and handing one a photograph would
      // contradict that. They render with the <img> dropped instead.
      const slots = photoSlotsUsed(design.html).filter((s) => s <= MAX_PHOTO_SLOTS);
      // Indexed BY SLOT, not by order of appearance -- renderDesignedSlide
      // reads photos[slot - 1], so a design that writes only {{PHOTO:2}} must
      // not have its picture land in slot 1's place.
      const forThisSlide: (PhotoChoice | null)[] = Array.from(
        { length: slots.length > 0 ? Math.max(...slots) : 0 },
        () => null,
      );
      for (const slot of slots) {
        forThisSlide[slot - 1] =
          photos.length > 0 ? photos[nextPhoto++ % photos.length] : null;
      }
      const assetIds = forThisSlide.map((p) => p?.id ?? null);

      // Identical markup on the identical photographs paints identical pixels.
      const already = unchanged.get(design.html);
      if (already && sameAssetIds(already.photoAssetIds, assetIds)) {
        already.violations.forEach((v) => problems.push(`Slide ${i + 1}: ${v}`));
        rendered.push({ ...already, violations: [...already.violations] });
        continue;
      }

      onProgress?.(`Drawing slide ${i + 1} of ${checked.designs.length}`);
      const { renderFilename, violation } = await renderOne(
        design,
        system!,
        aspectRatio,
        forThisSlide,
        options.logoPath ?? null,
      );
      if (violation) problems.push(`Slide ${i + 1}: ${violation}`);
      rendered.push({
        html: design.html,
        renderFilename,
        photo: design.photo,
        photoScenes: design.photos,
        photoAssetId: assetIds[0] ?? null,
        photoAssetIds: assetIds,
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
    onProgress?.("Correcting what didn't fit the brand's rules");
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
      const recheck = await attempt(second.slides, checked.slides);
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
    /** The photograph this slide may use, when it asks for one. */
    photo?: PhotoChoice | null;
    logoPath?: string | null;
  },
  meter: MeterContext,
  model: string = CONTENT_MODEL,
): Promise<{ slide: DesignedSlide; usage: GenerateResult["usage"] } | null> {
  const system = getDesignSystem();
  if (!system) return null;

  const aspectRatio = input.aspectRatio ?? "1:1";
  const { width, height } = canvasFor(aspectRatio);
  const hasPhotography = !!input.photo;

  // Computed from the real logo file, not stated as a fraction: its height is
  // its own aspect ratio at the stamped width, which no fixed phrasing can
  // stand in for. See logoReserveRule.
  const reserve = input.logoPath ? await logoBox(input.logoPath, width) : null;

  const systemPrompt = [
    getBusinessContext(),
    describeSystemForDesign(system),
    DESIGN_RULES,
    logoReserveRule(reserve, width, height),
    // A redesign holds ONE photograph at most -- input.photo, the picture the
    // slide already had -- so the count here is never more than 1 and the
    // second slot is never fillable. Without this the prompt taught
    // {{PHOTO:2}} and the filler below put input.photo in both slots, so
    // "redesign this as a before-and-after" came back showing one picture
    // twice under two headings and reported no error.
    photographyRuleFor(input.photo ? 1 : 0),
    getSignoffRule("social"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const askFor = `Topic: ${input.topic}\n\nDesign ONE slide on a ${width}x${height} canvas. Return ONLY the JSON in <design>...</design>, with exactly one entry in "slides".`;

  const redesignMove = pickOpeningMove(
    readKey<string | null>(LAST_OPENING_MOVE_KEY, null),
    hasPhotography,
  );

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
        content: `<design>\n${JSON.stringify({ caption: "", slides: [{ photos: [""], html: input.previousHtml }] })}\n</design>`,
      },
      {
        role: "user" as const,
        content: input.note?.trim()
          ? `${input.note.trim()}\n\nRedesign that slide accordingly. Keep everything the instruction does not touch. Same format.`
          : // A plain regenerate with no steer lands on a near-identical
            // composition surprisingly often — the model has just written this
            // slide, and it is the strongest thing in its context. Naming a
            // different direction is what makes "again, differently" actually
            // different. Only when the operator gave no instruction of their
            // own: a note is a steer, and this would fight it.
            `Design that slide again, differently. Same content, a different composition -- take it toward ${redesignMove.directive}. Same format.`,
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

  // The same slot-indexed assignment `attempt` makes, for the same reason:
  // renderDesignedSlide reads photos[slot - 1], so a redesign that comes back
  // using only {{PHOTO:2}} -- which the system prompt this very call sent
  // teaches it -- must not have its one photograph land at index 0, where the
  // markup has no <img> to fill. A one-entry list did exactly that, and the
  // slide came back with no photograph at all while renderFilename was
  // non-null, so the route's null-render guard showed the operator a broken
  // slide as a success. Slots past the cap stay unassigned: the audit has
  // already flagged them as unfillable, and handing one a photograph would
  // contradict that.
  //
  // One photograph goes in, so a two-slot redesign shows it in both slots:
  // redesigning a slide swaps the composition, not the library. That is what
  // `attempt`'s rotation does too whenever the library holds one photograph.
  const slots = photoSlotsUsed(design.html).filter((s) => s <= MAX_PHOTO_SLOTS);
  const forThisSlide: (PhotoChoice | null)[] = Array.from(
    { length: slots.length > 0 ? Math.max(...slots) : 0 },
    () => null,
  );
  for (const slot of slots) forThisSlide[slot - 1] = input.photo ?? null;
  // Derived from the list that was RENDERED, never from "does this markup use
  // a photograph": recording [input.photo.id] for markup using only slot 2
  // claimed slot 1 held that asset while the render carried no photograph --
  // and that id goes on to become the row's background_asset_id.
  const assetIds = forThisSlide.map((p) => p?.id ?? null);

  const { renderFilename, violation } = await renderOne(
    design,
    system,
    aspectRatio,
    forThisSlide,
    input.logoPath ?? null,
  );

  return {
    slide: {
      html: design.html,
      renderFilename,
      photo: design.photo,
      photoScenes: design.photos,
      photoAssetId: assetIds[0] ?? null,
      photoAssetIds: assetIds,
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
