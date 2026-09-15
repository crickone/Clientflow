import "server-only";

import { saveRender } from "@/lib/image/renderStore";

import { loadDesignFonts } from "./fonts";
import type { DesignSystem } from "./parse";
import { fillPhotoSlots, photoSlotsUsed } from "./photoSlots";
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
  /**
   * A photograph per slot, index 0 being slot 1. A slot whose entry is null or
   * absent has its <img> removed rather than left with a broken src.
   *
   * `photo` above is the one-slot shorthand and still works: a single
   * photograph is the common slide and should not have to be wrapped in a list.
   * When both are given, `photos` wins.
   */
  photos?: (SlidePhoto | null)[];
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
 * Resolve every photo placeholder, each slot with its own photograph.
 *
 * Substitution happens here rather than in the model's markup because satori
 * cannot fetch a URL and has no CSS filter: the image has to arrive already
 * graded, and inline. With no photograph the whole <img> goes rather than its
 * src, because a broken src is drawn as an empty box.
 *
 * This was `html.split(PHOTO_TOKEN).join(uri)` -- the same picture everywhere
 * the token appeared -- so a slide asking for two showed one of them twice.
 */
async function withPhotos(
  html: string,
  photos: (SlidePhoto | null)[],
  width: number,
  height: number,
  system: DesignSystem,
): Promise<string> {
  const slots = photoSlotsUsed(html);
  if (slots.length === 0) return html;

  // Grade each PHOTOGRAPH once, before substitution: fillPhotoSlots is
  // synchronous, and grading is the expensive step (~30ms of sharp work) -- a
  // slot that appears twice in the markup must not pay for it twice.
  //
  // Keyed by the photograph's PATH, not by the slot: two slots can hold the
  // same picture, and they do whenever the tenant library has only one, since
  // the generator's rotation then hands the same choice to both. Keying by
  // slot graded the identical file twice. The PROMISE is memoised, not the
  // result, so the second slot waits on the first slot's grade rather than
  // starting a duplicate of it.
  const gradeByPath = new Map<string, Promise<string>>();
  const gradeOf = (photo: SlidePhoto): Promise<string> => {
    const started = gradeByPath.get(photo.path);
    if (started) return started;
    const grading = gradedPhotoDataUri(photo.path, width, height, system.photo);
    gradeByPath.set(photo.path, grading);
    return grading;
  };

  // Concurrent, not a serial await per slot: the grades are independent, so a
  // two-photograph slide pays one grade's latency instead of two.
  const uris = await Promise.all(
    slots.map((slot) => {
      const photo = photos[slot - 1] ?? null;
      return photo ? gradeOf(photo) : Promise.resolve(null);
    }),
  );
  const uriBySlot = new Map<number, string | null>(
    slots.map((slot, i) => [slot, uris[i]]),
  );
  return fillPhotoSlots(html, (slot) => uriBySlot.get(slot) ?? null);
}

/**
 * A flat WxH image, as a data URI.
 *
 * Same dimensions as the photograph it stands in for, never a 1x1 stretched
 * by CSS: satori falls back to an image's intrinsic size when a style does
 * not pin both axes, and a stand-in of the wrong size measures -- or, for
 * this function's second caller, hit-tests -- a layout that never actually
 * rendered. One colour, so the only thing that differs from a real
 * photograph is how long it takes to decode.
 *
 * Exported because it now has two callers with the identical requirement:
 * this module's own overflow measurement (measurementHtmlFor, below) and the
 * hit map (lib/design/hitMap), which lays out click regions by rendering
 * this same markup and needs the click boxes to land where the real render
 * would put them. Two adapters are what make this a seam rather than an
 * implementation detail.
 */
export async function standInPhoto(width: number, height: number): Promise<string> {
  const sharp = (await import("sharp")).default;
  const flat = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 200, b: 190 } },
  })
    .jpeg({ quality: 50 })
    .toBuffer();
  return `data:image/jpeg;base64,${flat.toString("base64")}`;
}

/**
 * The markup with EVERY slot's photograph swapped for a flat image of the same
 * pixel size -- the markup the overflow measurement actually runs on.
 *
 * Exported as a seam because the property it exists for is not observable from
 * a render: both <img> tags in a real design pin width AND height, so a slide
 * measures the same whether slot 2 holds the stand-in or a live graded
 * photograph, and a graded photograph surviving into the measurement would
 * silently restore the ~111x payload the stand-in exists to avoid. The STRING
 * is where that is provable -- see renderDesignedSlide.test.ts.
 */
export async function measurementHtmlFor(
  html: string,
  width: number,
  height: number,
): Promise<string> {
  const start = html.indexOf("data:image/");
  if (start === -1) return html;
  const uri = await standInPhoto(width, height);
  // Every embedded image, not just the first: a design may carry the graded
  // photograph and nothing else today, but the substitution must not start
  // depending on that. The character class covers every image subtype satori
  // could plausibly be handed (jpeg, svg+xml, x-icon, vnd.microsoft.icon),
  // and the whole match is case-insensitive -- a data URI spelled
  // "DATA:IMAGE/JPEG;BASE64," is valid and was silently skipped before.
  //
  // A slide may now carry TWO photographs, and both are covered here: this
  // runs AFTER withPhotos, so each slot is already a data URI and each match
  // is replaced. Both stay exact, because withPhotos grades every slot's
  // photograph at the CANVAS's dimensions -- the same size this stand-in is
  // made at -- so satori infers the same intrinsic size either way.
  //
  // The divergence that would remain: an embedded image at some OTHER
  // intrinsic size would be measured at this canvas's size instead of its own,
  // since every match is replaced with the same WxH stand-in. Nothing produces
  // one today -- every image in a design is a graded photograph, and a model
  // cannot author base64 of its own -- but worth writing down.
  return html.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, uri);
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
  // `photos` wins over `photo`; `photo` is the one-slot shorthand.
  const photos = input.photos ?? (input.photo ? [input.photo] : []);
  const html = await withPhotos(input.html, photos, width, height, input.system);

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
  // helper: a caller that had to sequence this itself is a caller that could
  // forget it -- and two of the three copies had.
  //
  // It measures against a FLAT STAND-IN for the photograph, never the
  // photograph itself. Overflow is a question about where the text lands, and
  // satori lays an <img> out by the width and height in its style attribute --
  // which the stand-in carries unchanged, because only the src is swapped. So
  // the layout it measures is the layout that rendered.
  //
  // The cost is the whole point: measured here, a 1MB graded photograph took
  // 135 SECONDS to push through satori and sharp a second time, against 32ms
  // for the stand-in. Paying two minutes per keystroke-save to compute a
  // number is not a trade worth making, and it would have blown through the
  // editor's own 180s client timeout on a slide with a large photograph.
  const overflowPx = await measureOverflowPx(
    await measurementHtmlFor(html, width, height),
    width,
    height,
    fonts,
  );

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
