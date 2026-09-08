/**
 * The pure half of the composed-generation pass: what the model is TOLD about
 * a tenant's design system, and what is made of what it returns.
 *
 * Split from ./composeDesign.ts, which holds the model call, for the same
 * reason lib/design/parse.ts is split from system.ts — the server-only chain
 * (businessContext, the settings store) pulls React in transitively and cannot
 * load under the plain tsx test runner. Everything here is a pure function of
 * its arguments, so checkSlides can be driven with raw layouts and no network.
 */
import {
  ARCHETYPES,
  isSpecError,
  parseLayoutSpec,
  serializeLayoutSpec,
  type LayoutSpec,
} from "@/lib/design/grammar";
import {
  TYPE_LEVELS,
  columnWidth,
  valueHex,
  type DesignSystem,
} from "@/lib/design/parse";
import { validateCarousel, validateSlide } from "@/lib/design/validate";
import { rowFromSpec } from "@/lib/image/paintLayout";
// Type-only, so the server-only generator is erased and never loaded here.
import type { GenerateResult } from "@/lib/ai/generateCarousel";

// -------------------------------------------------------------------------
//  Describing a design system to the model
// -------------------------------------------------------------------------

/** The system as prose the model can act on — its own numbers, not ours. */
export function describeDesignSystem(system: DesignSystem): string {
  const lines: string[] = [];

  lines.push("THE BRAND'S DESIGN SYSTEM");
  lines.push("");
  lines.push("Values (the whole palette — there is no sixth colour):");
  for (const v of system.values) {
    const notes: string[] = [v.role];
    if (system.rules.neverType.includes(v.key)) {
      notes.push("NEVER set type in this");
    }
    lines.push(`- ${v.key} ${v.hex} — ${notes.join(", ")}`);
  }

  lines.push("");
  lines.push("Grounds (a slide's background must be one of these):");
  for (const g of system.grounds) {
    lines.push(
      `- ${g.value} — at most ${Math.round(g.share * 100)}% of a set, and never more than ${g.maxRun} slide${g.maxRun === 1 ? "" : "s"} in a row`,
    );
  }
  lines.push(
    "Use all of them across a set. A set that feels monotonous is fixed by changing a ground, not by enlarging a headline.",
  );

  lines.push("");
  lines.push("Type scale (choose a level per text slot):");
  for (const level of TYPE_LEVELS) {
    const t = system.type[level];
    lines.push(
      `- ${level} — ${t.size}px / ${t.leading} line-height${t.upper ? ", uppercase" : ""}`,
    );
  }

  lines.push("");
  lines.push(
    `Grid: ${system.grid.columns} columns of ${Math.round(columnWidth(system))}px on a ${system.grid.field}px field. A slot's "span" is its width in columns. Text sits in three or four columns; the empty columns are the calm and are not there to be filled.`,
  );

  lines.push("");
  lines.push(
    `Contrast is a rule, not a preference: body text needs ${system.rules.minContrastBody}:1 against its ground, large text ${system.rules.minContrastLarge}:1. Your layout is checked against this before anyone sees it.`,
  );

  return lines.join("\n");
}

export const GRAMMAR_RULES = `You compose each slide's LAYOUT as well as its copy, using the brand's own design system above.

You cannot position anything. You choose an ARCHETYPE and fill in its parameters:
${ARCHETYPES.map((a) => `- "${a.archetype}" — ${a.blurb} Photo: ${a.photo.join(" or ")}. ${a.slots.min}-${a.slots.max} text slots.`).join("\n")}

A layout is:
- "archetype": one of the above.
- "ground": a ground value key from the system.
- "photo": "full", "half" or "none", and only what the archetype allows. Choose "none" freely — a slide that carries a number or a list is stronger on a flat ground, and it costs nothing to make.
- "photoSide": "left" or "right", on a split slide only.
- "slots": the text of the slide, in reading order. Each slot is { "level": one of the type scale, "text": the words, "span": width in columns }.
- "accentRule" (optional): { "value": a value key, "place": "above" or "below" } — a short rule that divides. This is how you emphasise; an accent that fails as type is still perfect as a rule.

Slot rules:
- A "label" slot is a short eyebrow (2-4 words). At most one per slide.
- A "display" or "headline" slot carries the slide's heading. At most one per slide.
- "subhead" and "body" slots carry the copy. On a list slide, each item is its own body slot.
- Write the copy IN the slots. Do not repeat it anywhere else.

Copy rules:
- Plain text. No markdown, no emojis, no hashtags, no *asterisk* markup.
- Headings short and concrete (3-8 words). Bodies 1-3 short sentences.
- Slide 1 opens the series. The last slide closes it — send the reader to the link in bio (see the sign-off rule below).
- Never invent a statistic. Any figure must come from the business context or common knowledge.

Imagery: a slide whose layout uses a photograph ALSO carries an "image" field — a concrete photographic scene for its background (subject, setting, mood, composition). Vary the scenes while keeping one visual world, favour calm compositions with clear space, and NEVER describe text, signage, lettering or logos in the scene. A slide with "photo": "none" must NOT have an image field.

You also write the Instagram / Facebook caption for the whole carousel: a hook, 2-4 short paragraphs of real value, then the sign-off below naming the business. 80-200 words, plain text.

Output format — return ONLY a JSON object inside <slides>...</slides> tags, no other text:
<slides>
{
  "caption": "...",
  "slides": [
    {
      "image": "...",
      "layout": {
        "archetype": "statement",
        "ground": "ink",
        "photo": "full",
        "slots": [{ "level": "display", "text": "...", "span": 5 }]
      }
    }
  ]
}
</slides>

The "slides" array must contain exactly the number of slides requested, in order.`;

// -------------------------------------------------------------------------
//  Result types
// -------------------------------------------------------------------------

export interface ComposedSlide {
  /** Serialized LayoutSpec for `carousel_slides.layout_json`. */
  layoutJson: string;
  spec: LayoutSpec;
  /** Row columns, derived from the spec's own slots so the two cannot
   *  disagree at the moment a slide is created. */
  headingText: string;
  bodyText: string;
  tagline: string | null;
  /** Hex for `carousel_slides.background_color` — the ground, so colour lives
   *  on the row from the start and the operator can change it. */
  backgroundColor: string;
  accentColor: string;
  /** Photographic scene for the background, or "" when the layout wants none
   *  — which is how a flat slide avoids spending anything on imagery. */
  image: string;
  /** Rules this slide still breaks after the repair call. Shown to the
   *  operator, never hidden and never a reason to discard the slide. */
  violations: string[];
}

export interface ComposeResult {
  composed: true;
  slides: ComposedSlide[];
  caption: string;
  /** Set-level violations (the ground rotation), if any survived repair. */
  setViolations: string[];
  /** Whether the repair call was spent. */
  repaired: boolean;
  usage: GenerateResult["usage"];
}

export interface FellThroughResult extends GenerateResult {
  composed: false;
}

export type ComposeCarouselResult = ComposeResult | FellThroughResult;

// -------------------------------------------------------------------------
//  Parsing the model's reply
// -------------------------------------------------------------------------

export interface RawSlide {
  layout: unknown;
  image: string;
}

export function extractComposedPayload(text: string): {
  slides: RawSlide[];
  caption: string;
} {
  // A complete reply has both tags. A TRUNCATED one has the opening tag and no
  // closing tag, and the old code then fell back to parsing the whole string --
  // which begins "<slides>" and produced `SyntaxError: Unexpected token '<'`,
  // a message that says nothing about what actually went wrong. Name it.
  const closed = text.match(/<slides>([\s\S]*?)<\/slides>/i);
  if (!closed && /<slides>/i.test(text)) {
    throw new Error(
      "The design was cut off before it finished. Try fewer slides, or a shorter topic.",
    );
  }
  const jsonText = (closed ? closed[1] : text).trim();
  const cleaned = jsonText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { slides?: unknown; caption?: unknown };
  if (!Array.isArray(parsed.slides)) {
    throw new Error("Generator did not return a slides array.");
  }
  const caption =
    typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  const slides = parsed.slides.map((s, i): RawSlide => {
    if (!s || typeof s !== "object") {
      throw new Error(`Slide ${i + 1} is not an object.`);
    }
    const obj = s as Record<string, unknown>;
    return {
      layout: obj.layout,
      image: typeof obj.image === "string" ? obj.image.trim() : "",
    };
  });
  return { slides, caption };
}

/** The system's accent value, which fills rules and stands as the row's
 *  accentColor so a composed slide starts in palette. */
export function accentHexFor(system: DesignSystem): string | null {
  const accent = system.values.find((v) => v.role === "accent");
  return accent?.hex ?? null;
}

interface Checked {
  slides: ComposedSlide[];
  /** Per-slide problems, phrased for the model. Empty when everything held. */
  problems: string[];
  setViolations: string[];
}

/**
 * Parse and check every slide the model returned. Grammar errors and rule
 * violations are collected together, because from the model's point of view
 * they are the same kind of feedback: "this is what you got wrong, in the
 * vocabulary you were given".
 */
export function checkSlides(
  raw: RawSlide[],
  system: DesignSystem,
  accentColor: string,
): Checked {
  const problems: string[] = [];
  const slides: ComposedSlide[] = [];
  const specs: LayoutSpec[] = [];

  raw.forEach((r, i) => {
    const parsed = parseLayoutSpec(r.layout, system);
    if (isSpecError(parsed)) {
      problems.push(`Slide ${i + 1}: ${parsed.error}`);
      return;
    }
    const row = rowFromSpec(parsed);
    const groundHex = valueHex(system, parsed.ground) ?? "";
    const check = validateSlide(parsed, system, {
      background: groundHex,
      accent: accentColor,
      // Composed copy carries no asterisk markup, so the accent fills rules
      // rather than words.
      accentCarriesText: false,
      hasPhoto: parsed.photo !== "none",
    });
    const violations = check.ok ? [] : check.violations;
    violations.forEach((v) => problems.push(`Slide ${i + 1}: ${v}`));

    specs.push(parsed);
    slides.push({
      layoutJson: serializeLayoutSpec(parsed),
      spec: parsed,
      ...row,
      backgroundColor: groundHex,
      accentColor,
      // Imagery only where the layout uses one — a stat slide on a flat
      // ground never spends anything on a background.
      image: parsed.photo === "none" ? "" : r.image,
      violations,
    });
  });

  const set = validateCarousel(specs, system);
  const setViolations = set.ok ? [] : set.violations;
  problems.push(...setViolations);

  return { slides, problems, setViolations };
}
