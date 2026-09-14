import { PHOTO_TOKEN } from "@/lib/ai/designPost.parse";

import { hitColour } from "./hitMap";
import { standInPhoto } from "./renderDesignedSlide";
import { findTextRuns, type TextRun } from "./textRuns";

/**
 * Building the hit-map MARKUP -- as opposed to the pure colour encoding in
 * ./hitMap -- needs a real render of the design, and specifically needs
 * renderDesignedSlide's photo stand-in so the photograph's box lays out
 * exactly as it would in the real render (see the doc comment on
 * buildHitMapHtml below). renderDesignedSlide.ts starts with `import
 * "server-only"`, so anything that reaches it has to stay out of a client
 * bundle's import graph. ./hitMap is imported by a client component
 * (SlideTextEditor.tsx, for hitIndexAt); this file is not -- only the
 * slide-text route and this module's own tests call buildHitMapHtml -- which
 * is the whole reason this is a separate file rather than living alongside
 * the rest of the hit-map code.
 */

function injectStyle(openTag: string, declarations: string): string {
  const styleMatch = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
  if (styleMatch) {
    const quote = styleMatch[1][0];
    const existing = styleMatch[2] ?? styleMatch[3] ?? "";
    const sep = existing.trim().endsWith(";") || existing.trim() === "" ? "" : ";";
    const replaced = ` style=${quote}${existing}${sep}${declarations}${quote}`;
    return openTag.slice(0, styleMatch.index) + replaced + openTag.slice(styleMatch.index + styleMatch[0].length);
  }
  // No style attribute at all — add one just before the tag closes.
  return `${openTag.slice(0, -1)} style="${declarations}">`;
}

/**
 * Build the markup for the hit map. Returns the HTML plus the runs it encoded,
 * so a caller never has to re-scan and risk a different numbering.
 *
 * The design is left structurally untouched. Only two things change per text
 * element: a background colour and transparent text, both appended to the
 * existing inline style so they win as later declarations. No wrapper, no new
 * child, no display change — so the layout being hit-tested is exactly the
 * layout on screen. (This is also why ./textRuns refuses mixed content: making
 * that editable would require a wrapper element, and a wrapper can change what
 * satori's `prepare` does to the parent.)
 *
 * Photographs are blanked, keeping their box (an <img> in these designs takes
 * its size from `style`, never from attributes) but removing every colour
 * they contribute -- a photo contains every colour there is, including
 * whichever ones were chosen to encode indices with. The stand-in is a flat
 * image at the CANVAS's own dimensions, the same one renderDesignedSlide uses
 * for its overflow measurement, not a 1x1 pixel: satori falls back to an
 * image's INTRINSIC size whenever a style pins only one axis, so a stand-in
 * of the wrong size lays out a box the real render never had, and the hit map
 * silently drifts off the words it is supposed to be mapping. A 1x1 pixel
 * measured 150px off on a real slide before this was caught.
 *
 * `width`/`height` are the CANVAS the slide renders at -- required so the
 * photo stand-in above can be built at that exact size.
 */
export async function buildHitMapHtml(
  html: string,
  band: number,
  width: number,
  height: number,
): Promise<{ html: string; runs: TextRun[] }> {
  const runs = findTextRuns(html);

  // Rewrite from the END so earlier offsets stay valid.
  let out = html;
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const openTag = out.slice(run.tagStart, run.tagEnd + 1);
    const painted = injectStyle(
      openTag,
      `background-color:${hitColour(run.index, band)};color:transparent;`,
    );
    out = out.slice(0, run.tagStart) + painted + out.slice(run.tagEnd + 1);
  }

  // Blank every image: same box, no colour. Covers both a substituted photo
  // and the {{PHOTO}} token that is still in the stored markup.
  const standIn = await standInPhoto(width, height);
  out = out.replace(/(<img[^>]*\ssrc\s*=\s*)("[^"]*"|'[^']*')/gi, `$1"${standIn}"`);
  out = out.split(PHOTO_TOKEN).join(standIn);

  return { html: out, runs };
}
