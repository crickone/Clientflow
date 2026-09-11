/**
 * The pure half of the design pass: what the model is told, and what is made of
 * what it returns.
 *
 * Split from ./designPost.ts for the same reason composeDesign.parse.ts was --
 * the server-only chain (businessContext, the settings store) pulls React in
 * transitively and will not load under the plain tsx runner, so everything that
 * can be tested without a network call lives here.
 */
import { auditDesignHtml, extractColours } from "@/lib/design/htmlAudit";
import { TYPE_LEVELS, columnWidth, type DesignSystem } from "@/lib/design/parse";
import { findTextRuns } from "@/lib/design/textRuns";

export interface RawDesign {
  html: string;
  /** A photographic scene for this slide, or "" when the design uses none. */
  photo: string;
}

export interface CheckedDesign extends RawDesign {
  violations: string[];
}

/** The placeholder the model writes where a photograph goes. Substituted with a
 *  graded data URI at render time, because satori cannot fetch a URL. */
export const PHOTO_TOKEN = "{{PHOTO}}";

/** The tenant's system, as instructions a designer can act on. */
export function describeSystemForDesign(system: DesignSystem): string {
  const lines: string[] = ["THE BRAND'S DESIGN SYSTEM", ""];

  lines.push("Palette -- these are the only colours. Do not invent one:");
  for (const v of system.values) {
    const notes: string[] = [v.role];
    if (system.rules.neverType.includes(v.key)) {
      notes.push("NEVER set type in this - rules, blocks and fills only");
    }
    lines.push(`- ${v.key} ${v.hex} -- ${notes.join(", ")}`);
  }

  // A palette may carry several accents; a POST commits to one. Two accents
  // across a set reads as two brands, which is what a real carousel did when
  // it put the lime and the blue on the same slides.
  const accentKeys = system.values.filter((v) => v.role === "accent").map((v) => v.key);
  if (accentKeys.length > 1) {
    lines.push(
      "",
      `This palette carries more than one accent (${accentKeys.join(", ")}). A SET COMMITS TO ONE. Choose the accent before you design slide 1, use only that one across every slide, and do not use the others anywhere in this post.`,
    );
  }

  lines.push("", "Grounds -- a slide's background is one of these:");
  for (const g of system.grounds) {
    lines.push(
      `- ${g.value} -- at most ${Math.round(g.share * 100)}% of a set, never more than ${g.maxRun} slide${g.maxRun === 1 ? "" : "s"} in a row`,
    );
  }
  lines.push(
    "Use all of them across a set. Monotony is fixed by changing a ground, not by enlarging a headline.",
  );

  lines.push("", "Type scale (px on a 1080 field -- scale proportionally on a larger canvas):");
  for (const level of TYPE_LEVELS) {
    const t = system.type[level];
    lines.push(
      `- ${level}: ${t.size}px, line-height ${t.leading}, letter-spacing ${t.tracking}em, weight ${t.weight}${t.upper ? ", UPPERCASE" : ""}`,
    );
  }

  const body = system.bodyFont ?? system.font;
  lines.push("", "Typefaces -- these are the ONLY faces the renderer has:");
  if (body === system.font) {
    lines.push(
      `- ${system.font}, for everything. Every text element sets font-family:${system.font}`,
    );
  } else {
    lines.push(
      `- ${system.font} for display and headline levels: font-family:${system.font}`,
      `- ${body} for subhead, body and label levels: font-family:${body}`,
    );
  }
  lines.push(
    "Write the family name with NO quotation marks around it -- a quote inside a style attribute ends the attribute, and every declaration after it is silently thrown away. Any name not listed above renders in a fallback face.",
  );

  lines.push(
    "",
    `Grid: ${system.grid.columns} columns of ${Math.round(columnWidth(system))}px, margins ${system.grid.margin}px, gutters ${system.grid.gutter}px. Text sits in three or four columns. The empty columns are the calm and are not there to be filled.`,
    `Contrast: body text needs ${system.rules.minContrastBody}:1 against its ground, large text ${system.rules.minContrastLarge}:1.`,
  );

  // The compositional vocabulary. A system's own motifs are what make ITS
  // posts recognisable; without them every system produces the same shapes in
  // different colours, which is precisely the complaint that put this field
  // here. The generic list is the fallback for a system that has none.
  lines.push("", "THE MOVES THIS BRAND MAKES -- these are its signature, not suggestions:");
  if (system.motifs.length > 0) {
    for (const m of system.motifs) lines.push(`- ${m}`);
    lines.push(
      "Build each slide out of these. Use two or three per slide, not all of them, and a DIFFERENT combination on each slide of a set -- the moves are the brand, the repetition is not.",
      "Setting: flush left, ragged right unless a move above says otherwise. No justification, no italics.",
    );
  } else {
    lines.push(
      "- A figure or word oversized and cropped by the canvas edge.",
      "- A panel of type overlapping a full-bleed photograph.",
      "- An asymmetric split where a band of a second ground cuts the first.",
      "- A rule that crosses the whole composition.",
      "- A list as cards on the signature ground.",
      "Vary them across a set -- five slides of the same shape read as a template, which is the thing this exists to avoid.",
      "Setting: flush left, ragged right. No centred type, no justification, no italics.",
    );
  }

  if (system.templates.length > 0) {
    lines.push(
      "",
      "THE SLIDE TYPES THIS STYLE IS BUILT FROM. A set moves between them -- a DIFFERENT one for each slide, chosen for what that slide has to do:",
    );
    for (const t of system.templates) lines.push(`- ${t.name}: ${t.structure}`);
    lines.push(
      "These describe a structure, not a stencil. You decide the proportions, the crop, the emphasis and what goes where inside one. Use each slide type AT MOST ONCE in a set, and not in the order listed. If the set has more slides than there are slide types, the one you repeat must be visibly a different slide -- another ground, another scale, another crop -- and never with the same kicker or running head as the first.",
    );
  }

  return lines.join("\n");
}

/**
 * How to write markup this renderer can actually draw.
 *
 * Every constraint below was found by rendering something and looking at it.
 * They are not style preferences: satori implements a SUBSET of CSS, and markup
 * that ignores this renders wrong, or silently renders nothing at all.
 */
export const DESIGN_RULES = `YOU ARE DESIGNING THE POST, not filling in a template. Compose each slide yourself: decide the structure, the scale, what dominates and what stays quiet. Every colour and type size comes from the system above; the composition is yours.

Write ONE HTML element per slide. It is rendered by satori, which supports a SUBSET of CSS. Stay inside it:
- FLEXBOX ONLY. No grid, no float, no table.
- ANY element with MORE THAN ONE child must set "display:flex", and must set "flex-direction:column" whenever those children stack vertically (the default is row). Without it the render fails outright with "Expected <div> to have explicit display: flex".
- An element containing ONLY TEXT must NOT set "display:flex". Give it a "width" in px and let the text wrap inside that width. display:flex on a text element makes each run of text a side-by-side item, so a heading comes out on one line and runs off the canvas.
- Those two rules are not in conflict: containers get display:flex, the leaf elements that hold words do not.
- NEVER write <br>. It is not a line break here -- it splits the text into separate flex items on the same line, and the words collide. To break a line, either let the text wrap inside its width, or make each line its own child of a "flex-direction:column" parent.
- Absolute positioning IS supported ("position:absolute" inside a "position:relative" parent). It is how you overlap, bleed a figure off the edge, or pin a footer.
- NO CSS filter, backdrop-filter, mix-blend-mode or mask. A photograph arrives already graded.
- An <img> takes its size in "style" -- style="width:1080px;height:1080px;object-fit:cover". NEVER as width/height attributes: as attributes it silently renders nothing.
- Gradients work, and rgba() is how you build a scrim so type stays readable over a photograph.
- No external CSS, no <style> block, no classes, no CSS variables. Inline "style" only.
- Write characters directly, NEVER HTML entities. Type the actual character.
- font-family is exactly the typeface named in the design system above. No other face exists in the renderer.

The canvas is EXACTLY the size you are told. The outermost element sets that width and height in px, "display:flex", and "position:relative".

Keep every element inside the canvas and clear of the others. Nothing may overlap text, and nothing may run off an edge unless you meant it to. Give every text element an explicit "width" so it wraps where you intend rather than where it runs out of canvas.

ANCHOR THE COMPOSITION, and do not leave a hole in it. Quiet space is a BAND at one edge, never a gap in the middle: either the content runs down to the bottom margin, or it starts below the midline and the space sits above it. A slide that fills the top two thirds and then stops -- a band of nothing between the last paragraph and the footer -- reads as unfinished, not composed. If the copy does not reach the bottom on its own, set it larger, move the whole block down, or close the slide with something that belongs there: a figure, a rule, a caption, a band of a second ground, a photograph.

SET HEADINGS LARGE. A carousel is read at thumbnail size in a feed, so a heading that looks generous on screen is merely legible in the app. A slide's MAIN heading -- the line the slide is about -- is DISPLAY size. The headline level is for a secondary heading inside a slide, never for the thing the slide is about, and when a heading sits between two levels take the larger one.

Never place two items SIDE BY SIDE to compare them -- at feed size a pair of columns becomes two narrow strips nobody reads. Stack them down the page instead, each with its own heading at subhead size or larger, separated by a rule or a change of ground rather than shut inside cards.

Where a slide uses a photograph, write the src EXACTLY as ${PHOTO_TOKEN} -- that placeholder is replaced with the real image. Use it at most once per slide, and give that slide a "photo" field describing the scene: subject, setting, mood, composition. Never describe text, signage or lettering in shot. A slide with no photograph has "photo": "".

Copy: plain text, no markdown, no emojis, no hashtags. Headings short and concrete.

NEVER INVENT A FACT. That covers prices, session lengths, opening times, offers, phone numbers, addresses and statistics alike. If a number is not in the business context above, it does not go on the slide -- write the sentence without it. A plausible-looking price on a health clinic's post is worse than no price, because someone will turn up expecting it.

Output format -- return ONLY this JSON inside <design>...</design> tags, no other text:
<design>
{
  "caption": "the Instagram caption for the whole post",
  "slides": [
    { "photo": "a quiet treatment room, daylight", "html": "<div style=\\"display:flex;position:relative;width:1080px;height:1080px;...\\">...</div>" }
  ]
}
</design>
The "slides" array must hold exactly the number of slides requested, in order.`;

/** The logo's region on the canvas, as the renderer computes it. Mirrors
 *  LogoBox in @/lib/design/renderDesign, redeclared here so this file keeps its
 *  no-runtime-import property and stays loadable under the plain test runner. */
export interface LogoReserve {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The space the logo needs, in exact pixels on THIS canvas.
 *
 * Exact, because the previous phrasing ("roughly a quarter of the width and a
 * tenth of the height") was wrong in the direction that hurts: the height a
 * logo actually occupies is its own aspect ratio at a 19% width, which for a
 * squarish mark is over a quarter of the canvas. A model that believed the
 * tenth put its running head and slide counter inside the box, and the logo
 * was composited on top of both.
 */
export function logoReserveRule(
  box: LogoReserve | null,
  width: number,
  height: number,
): string {
  if (!box) {
    return "NO LOGO IS STAMPED on these slides, so the top-right corner is yours to compose into. Do not draw a logo, a wordmark or the business name yourself -- this post simply carries none.";
  }
  const fromRight = width - box.left;
  const bottom = box.top + box.height;
  const gap = Math.round(width * 0.02);
  return `KEEP THE LOGO'S BOX CLEAR. After you design a slide, the business's logo is composited into a box ${box.width}px wide and ${box.height}px tall, its top-left corner at x=${box.left}, y=${box.top} on the ${width}x${height} canvas -- ${fromRight}px in from the right edge, and reaching ${bottom}px down from the top.

Nothing you draw may enter that box: no text, no rule, no figure, no block of colour. A running head, a slide counter, a kicker or anything else along the top must sit either entirely LEFT of x=${box.left - gap}, or entirely BELOW y=${bottom + gap}. A rule that spans the full width belongs below y=${bottom + gap}, otherwise it cuts straight through the mark.

A full-bleed photograph MAY pass under the box -- the logo is recoloured for whatever it lands on -- but keep the busiest part of the picture out of it.

Do not draw a logo, a wordmark or the business name yourself.`;
}

/**
 * Told to the model when the tenant has no photography.
 *
 * Necessary because stripping a photo AFTER the fact does not undo the design
 * built around it: a real generation asked for a full-bleed image, the <img>
 * was removed, and the scrim gradient meant to sit over it was left lying on a
 * flat ground as a muddy wash. A design that never expected a photograph is
 * coherent; one with the photograph cut out of it is not.
 */
export const NO_PHOTOGRAPHY_RULE = `NO PHOTOGRAPHY IS AVAILABLE for this post. Every slide must work on a flat ground. Do not write ${PHOTO_TOKEN}, do not write an <img>, and do not build a scrim or gradient of the kind that only makes sense over an image. Set "photo" to "" on every slide.`;

export function extractDesignPayload(text: string): {
  slides: RawDesign[];
  caption: string;
} {
  // A complete reply has both tags. A TRUNCATED one has the opening tag and no
  // closing tag; parsing the whole string then fails inside JSON.parse with a
  // message about an unexpected "<", which tells the operator nothing. Name it.
  const closed = text.match(/<design>([\s\S]*?)<\/design>/i);
  if (!closed && /<design>/i.test(text)) {
    throw new Error(
      "The design was cut off before it finished. Try fewer slides, or a shorter topic.",
    );
  }
  const jsonText = (closed ? closed[1] : text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(jsonText) as { slides?: unknown; caption?: unknown };
  if (!Array.isArray(parsed.slides)) {
    throw new Error("The designer did not return a slides array.");
  }
  return {
    caption: typeof parsed.caption === "string" ? parsed.caption.trim() : "",
    slides: parsed.slides.map((s, i): RawDesign => {
      if (!s || typeof s !== "object") {
        throw new Error(`Slide ${i + 1} is not an object.`);
      }
      const o = s as Record<string, unknown>;
      return {
        html: typeof o.html === "string" ? o.html : "",
        photo: typeof o.photo === "string" ? o.photo.trim() : "",
      };
    }),
  };
}

/**
 * A slide's composition, reduced to the things that make two slides read as
 * the same slide: the ground it sits on, the set of type sizes it uses, how
 * many text elements it has, and whether it carries a photograph.
 *
 * Deliberately coarse on content and exact on structure. Two slides saying
 * different words in the same shape ARE the same slide at feed size, which is
 * the complaint; two slides sharing a heading size but differing in ground or
 * in how many blocks they hold are not.
 */
function compositionSignature(html: string): string {
  const sizes = [
    ...new Set(
      [...html.matchAll(/font-size\s*:\s*(\d+)px/gi)].map((m) => Number(m[1])),
    ),
  ]
    .sort((a, b) => a - b)
    .join(",");
  // The outermost background is the ground. Later ones are bands and blocks.
  const ground = html.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})/i)?.[1].toLowerCase() ?? "none";
  const photo = /<img\b/i.test(html) ? "photo" : "flat";
  return `${ground}|${sizes}|${findTextRuns(html).length}|${photo}`;
}

/**
 * The problems no single slide can see, phrased for the repair call.
 *
 * Both came off a real seven-slide carousel: two of its slides were the same
 * composition down to the same kicker, and the set used two different accents
 * on the same slides, which reads as two brands rather than one.
 */
export function checkSet(raw: RawDesign[], system: DesignSystem): string[] {
  const problems: string[] = [];

  const bySignature = new Map<string, number[]>();
  raw.forEach((r, i) => {
    if (!r.html.trim()) return;
    const sig = compositionSignature(r.html);
    bySignature.set(sig, [...(bySignature.get(sig) ?? []), i + 1]);
  });
  for (const slides of bySignature.values()) {
    if (slides.length < 2) continue;
    const [, ...rest] = slides;
    problems.push(
      `Slides ${slides.join(" and ")} are the same composition -- the same ground, the same type sizes and the same number of text blocks. A set moves between slide types. Rebuild slide${rest.length === 1 ? "" : "s"} ${rest.join(" and ")} as a different slide type.`,
    );
  }

  // One accent per set. A palette may offer several; a post commits to one.
  const accents = new Map<string, string>();
  for (const v of system.values) {
    if (v.role === "accent") accents.set(v.hex, v.key);
  }
  if (accents.size > 1) {
    const used = new Map<string, number[]>();
    raw.forEach((r, i) => {
      for (const c of extractColours(r.html)) {
        if (accents.has(c)) used.set(c, [...(used.get(c) ?? []), i + 1]);
      }
    });
    if (used.size > 1) {
      const named = [...used.entries()]
        .map(([hex, slides]) => `${accents.get(hex)} ${hex} (slide${slides.length === 1 ? "" : "s"} ${slides.join(", ")})`)
        .join(" and ");
      problems.push(
        `This set uses two accents: ${named}. A post commits to ONE accent throughout -- two of them read as two brands. Pick one and restate the other slides in it.`,
      );
    }
  }

  return problems;
}

/**
 * Audit every design. `problems` is phrased for the repair call; the designs
 * come back regardless, because a flagged slide is SHOWN, never discarded.
 */
export function checkDesigns(
  raw: RawDesign[],
  system: DesignSystem,
): { designs: CheckedDesign[]; problems: string[] } {
  const problems: string[] = [];
  const designs: CheckedDesign[] = [];

  raw.forEach((r, i) => {
    const violations: string[] = [];
    if (!r.html.trim()) {
      violations.push("This slide has no markup.");
    } else {
      const audit = auditDesignHtml(r.html, system);
      if (!audit.ok) violations.push(...audit.violations);
      // Cheap, and catches the renderer's most common silent failure before a
      // canvas is ever allocated.
      if (!/display\s*:\s*flex/i.test(r.html)) {
        violations.push(
          "The outermost element does not set display:flex, so this will not render.",
        );
      }
      // A <br> is not a line break in satori: it splits the text into separate
      // flex items on the same line, so the words collide and the heading runs
      // off the canvas. Caught by rendering a real generation and looking at it.
      if (/<br\b/i.test(r.html)) {
        violations.push(
          "This uses <br>, which is not a line break here -- it puts the text side by side on one line. Let the text wrap inside an explicit width instead.",
        );
      }
    }
    violations.forEach((v) => problems.push(`Slide ${i + 1}: ${v}`));
    designs.push({ ...r, violations });
  });

  // Set-level problems are NOT slide violations: they belong to no one slide,
  // so they go to the repair call without putting a warning badge on a slide
  // that is fine on its own terms.
  problems.push(...checkSet(raw, system));

  return { designs, problems };
}
