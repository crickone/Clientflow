import "server-only";

import { PHOTO_TOKEN } from "@/lib/ai/designPost.parse";
import { saveRender } from "@/lib/image/renderStore";

import { loadDesignFonts } from "./fonts";
import type { DesignSystem } from "./parse";
import {
  gradedPhotoDataUri,
  measureOverflowPx,
  renderDesignToPng,
  stampLogo,
} from "./renderDesign";

/**
 * THE recipe for turning a designed slide's markup into the PNG an operator
 * sees. One module, one order of steps.
 *
 * It existed three times before this -- inside the generator (renderOne), in
 * the photo-swap route and in the click-to-edit text route -- and the copies
 * had already diverged: only the generator measured overflow, only two of the
 * three stripped the <img> when no photograph was available, and one of them
 * matched the photo placeholder with a bare string literal rather than the
 * constant the rest of the codebase shares. Each of those is a slide that
 * comes back subtly different depending on WHICH button the operator pressed,
 * which is exactly the class of bug a duplicated recipe produces.
 *
 * The inputs are the inputs the recipe actually needs -- markup, aspect ratio,
 * photograph, logo, design system -- deliberately NOT a slide row. The
 * generator runs this mid-generation, before any row exists; the routes have
 * rows. A row-shaped interface would serve the routes and force the generator
 * to fabricate a row out of nothing.
 */

/** Slide dimensions by aspect ratio. The canvas the model is told to fill, and
 *  the canvas every render path sizes to -- the generator, the redesign, the
 *  photo swap and the text editor. */
export const CANVAS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/** The canvas for an aspect ratio, falling back to square. Square is the
 *  default everywhere a ratio is optional, and an unrecognised stored value
 *  must render SOMETHING rather than throw at the operator. */
export function canvasFor(aspectRatio: string | null | undefined): {
  width: number;
  height: number;
} {
  return CANVAS[aspectRatio ?? "1:1"] ?? CANVAS["1:1"];
}

/**
 * Built from PHOTO_TOKEN rather than written out, so the placeholder has ONE
 * definition. A literal `\{\{PHOTO\}\}` here would keep matching after someone
 * changed the constant, and the failure would be silent: the token simply
 * survives into the markup and satori draws an empty box where the photograph
 * should be.
 */
const PHOTO_IMG_TAG = new RegExp(
  `<img[^>]*${PHOTO_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`,
  "gi",
);

/** The photograph a slide may use. Structural on purpose -- the generator's
 *  PhotoChoice and the routes' library rows both satisfy it without this
 *  module needing to know about either. */
export interface SlidePhoto {
  path: string;
}

export interface RenderDesignedSlideInput {
  /** The authored markup, with the photo placeholder still in it. */
  html: string;
  /** "1:1" | "4:5" | "9:16"; anything else, or absent, renders square. */
  aspectRatio?: string | null;
  /** The photograph to substitute, or null to strip the <img> instead. */
  photo?: SlidePhoto | null;
  /** The tenant's logo file, stamped after the design. Null omits it. */
  logoPath?: string | null;
  /** The tenant's design system -- supplies the photo grade and the faces. */
  system: DesignSystem;
}

export interface DesignedSlideRender {
  /** The stored PNG's filename. The store is content-addressed, so identical
   *  inputs overwrite rather than accumulate. */
  filename: string;
  width: number;
  height: number;
  /**
   * How far the content runs past the bottom of the canvas, 0 when it fits.
   *
   * Measured on EVERY path, not just generation. satori has no auto-fit, so a
   * slide with one sentence too many renders "successfully" with its last line
   * sliced off at the canvas edge -- and an edit that pushes a slide over that
   * line is just as capable of producing it as a generation is. A caller with
   * nowhere to report it may ignore it; what it must not do is not know.
   */
  overflowPx: number;
}

/**
 * Resolve the photo placeholder.
 *
 * Substitution happens here rather than in the model's markup because satori
 * cannot fetch a URL and has no CSS filter: the image has to arrive already
 * graded, and inline. With no photograph the whole <img> goes rather than its
 * src, because a broken src is drawn as an empty box.
 */
async function withPhoto(
  html: string,
  photo: SlidePhoto | null,
  width: number,
  height: number,
  system: DesignSystem,
): Promise<string> {
  if (!html.includes(PHOTO_TOKEN)) return html;
  if (!photo) return html.replace(PHOTO_IMG_TAG, "");
  const uri = await gradedPhotoDataUri(photo.path, width, height, system.photo);
  return html.split(PHOTO_TOKEN).join(uri);
}

/**
 * Render one designed slide and store it.
 *
 * THROWS when the markup will not render -- satori rejects a container missing
 * display:flex, a font file can go missing, sharp can refuse an image. Every
 * caller already has somewhere to put that: the generator turns it into a
 * violation the repair call can act on, and the routes turn it into a 500 with
 * the renderer's own words. Swallowing it here would take that choice away
 * from both.
 */
export async function renderDesignedSlide(
  input: RenderDesignedSlideInput,
): Promise<DesignedSlideRender> {
  const { width, height } = canvasFor(input.aspectRatio);
  const html = await withPhoto(
    input.html,
    input.photo ?? null,
    width,
    height,
    input.system,
  );

  const fonts = await loadDesignFonts(
    input.system.font,
    input.system.bodyFont,
    input.system.altFont,
  );
  let png = await renderDesignToPng(html, width, height, fonts);
  if (input.logoPath) {
    // Stamped after the design, never asked for in the markup -- placement and
    // size are brand rules, not something to leave to a model.
    png = await stampLogo(png, input.logoPath, width, height);
  }

  // The SECOND satori pass, and the reason this is a module rather than a
  // helper: it runs on the resolved markup, at the same width, after the photo
  // has been substituted. A caller that had to sequence this itself is a
  // caller that could forget it -- and two of the three copies had.
  const overflowPx = await measureOverflowPx(html, width, height, fonts);

  // The render is kept even when it overflows: a clipped slide the operator
  // can see beats no slide at all, and the measurement is what puts it in
  // front of whatever can fix it.
  return { filename: saveRender(png), width, height, overflowPx };
}

/**
 * The operator-facing sentence for an overflowing slide, in the words the
 * repair call is asked to act on. Here rather than in the generator so every
 * caller that grows somewhere to report overflow says the same thing.
 */
export function overflowViolation(
  overflowPx: number,
  width: number,
  height: number,
): string {
  return (
    `The content runs about ${overflowPx}px past the bottom of the ${width}x${height} canvas, ` +
    `so the last lines are cut off. Cut copy or reduce the font-size until everything fits ` +
    `inside the canvas with the margins intact -- do not just shrink the padding.`
  );
}
