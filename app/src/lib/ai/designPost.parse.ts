/**
 * The pure half of the design pass: what the model is told, and what is made of
 * what it returns.
 *
 * Split from ./designPost.ts for the same reason composeDesign.parse.ts was --
 * the server-only chain (businessContext, the settings store) pulls React in
 * transitively and will not load under the plain tsx runner, so everything that
 * can be tested without a network call lives here.
 */
import { auditDesignHtml } from "@/lib/design/htmlAudit";
import { TYPE_LEVELS, columnWidth, type DesignSystem } from "@/lib/design/parse";

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

  lines.push(
    "",
    `Grid: ${system.grid.columns} columns of ${Math.round(columnWidth(system))}px, margins ${system.grid.margin}px, gutters ${system.grid.gutter}px. Text sits in three or four columns. The empty columns are the calm and are not there to be filled.`,
    `Contrast: body text needs ${system.rules.minContrastBody}:1 against its ground, large text ${system.rules.minContrastLarge}:1.`,
    "Setting: flush left, ragged right. No centred type, no justification, no italics.",
  );

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
- FLEXBOX ONLY. No grid, no float, no table. EVERY element that has children must set "display:flex". This is the single most common mistake and the slide will not render without it.
- Set "flex-direction:column" explicitly whenever children stack vertically. The default is row.
- Absolute positioning IS supported ("position:absolute" inside a "position:relative" parent). It is how you overlap, bleed a figure off the edge, or pin a footer.
- NO CSS filter, backdrop-filter, mix-blend-mode or mask. A photograph arrives already graded.
- An <img> takes its size in "style" -- style="width:1080px;height:1080px;object-fit:cover". NEVER as width/height attributes: as attributes it silently renders nothing.
- Gradients work, and rgba() is how you build a scrim so type stays readable over a photograph.
- No external CSS, no <style> block, no classes, no CSS variables. Inline "style" only.
- Write characters directly, NEVER HTML entities. Type the actual character.
- font-family is exactly "Inter".

The canvas is EXACTLY the size you are told. The outermost element sets that width and height in px, "display:flex", and "position:relative".

Moves worth making, because a fixed template cannot: a figure or word oversized and cropped by the canvas edge; a panel of type overlapping a full-bleed photograph; an asymmetric split where a band of a second ground cuts the first; a rule that crosses the whole composition; a list as cards on the signature ground. Vary them across a set -- five slides of the same shape read as a template, which is the thing this exists to avoid.

Keep every element inside the canvas and clear of the others. Nothing may overlap text, and nothing may run off an edge unless you meant it to.

Where a slide uses a photograph, write the src EXACTLY as ${PHOTO_TOKEN} -- that placeholder is replaced with the real image. Use it at most once per slide, and give that slide a "photo" field describing the scene: subject, setting, mood, composition. Never describe text, signage or lettering in shot. A slide with no photograph has "photo": "".

Copy: plain text, no markdown, no emojis, no hashtags. Headings short and concrete. Never invent a statistic.

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
    }
    violations.forEach((v) => problems.push(`Slide ${i + 1}: ${v}`));
    designs.push({ ...r, violations });
  });

  return { designs, problems };
}
