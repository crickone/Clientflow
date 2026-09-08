import "server-only";
import { decodeHTML } from "entities";
import sharp from "sharp";

import type { DesignFont } from "./fonts";

/**
 * satori and satori-html are loaded LAZILY, for two reasons.
 *
 * Correctness: satori-html depends on `ultrahtml`, which is ESM-only, so a
 * static import cannot be required from a CJS context (the tsx runner the
 * project's scripts and tests use). A dynamic import works in both.
 *
 * Cost: satori carries WASM layout and text-shaping engines. Loading them at
 * module scope would put that on the cold start of every route that happens to
 * pull this file in transitively, when only a design render needs them.
 */
type SatoriFn = typeof import("satori")["default"];
type HtmlFn = typeof import("satori-html")["html"];
let satoriPromise: Promise<{ satori: SatoriFn; toNodes: HtmlFn }> | null = null;

function loadSatori() {
  if (!satoriPromise) {
    satoriPromise = Promise.all([import("satori"), import("satori-html")]).then(
      ([s, h]) => ({ satori: s.default, toNodes: h.html }),
    );
  }
  return satoriPromise;
}

/**
 * THE ONLY RENDERER for an AI-designed slide.
 *
 * A designed slide is HTML. This turns it into the PNG that is BOTH what the
 * editor shows and what the operator exports -- the same bytes, not two code
 * paths that agree. That is a stronger guarantee than the one paintSlide gave
 * the fixed templates, where a preview canvas and an export canvas ran the same
 * function and could only drift if someone edited one of them.
 *
 * satori implements a SUBSET of CSS. The limits that actually bite:
 *   - flexbox only, and every element with children must set `display:flex`
 *   - no `filter` / `backdrop-filter` / `mask` -- a photograph must arrive
 *     already graded (see gradedPhotoDataUri below)
 *   - an <img> takes its size from `style`, never from width/height attributes;
 *     as attributes it silently renders NOTHING
 *   - no external stylesheets, no classes -- inline `style` only
 *
 * Those are stated in the generation prompt rather than patched around here. A
 * design that quietly loses a rule is worse than one that fails loudly.
 */
export async function renderDesignToPng(
  html: string,
  width: number,
  height: number,
  fonts: DesignFont[],
): Promise<Buffer> {
  const { satori, toNodes } = await loadSatori();
  // The cast is the honest shape of this seam: satori-html returns its own
  // node tree, satori types its input as ReactNode, and the two are structurally
  // the same object. `prepare` preserves that structure exactly.
  const nodes = prepare(toNodes(html)) as Parameters<SatoriFn>[0];
  const svg = await satori(nodes, { width, height, fonts });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Make a parsed HTML tree renderable: decode entities in text, and give
 * multi-child elements the explicit display satori demands.
 *
 * ENTITIES. satori-html's parser leaves them alone, so "&middot;" reaches the
 *
 * canvas as the six literal characters -- caught by rendering a slide and
 * looking at it. A model writes entities freely, so this cannot be left to the
 * prompt. It runs AFTER parsing, and only on text nodes, which is the whole
 * point: decoding the raw string first would turn an escaped "&lt;div&gt;" into
 * a real element and let content become markup.
 */
function prepare(node: unknown): unknown {
  if (typeof node === "string") return decodeHTML(node);
  if (Array.isArray(node)) return node.map(prepare);
  if (!node || typeof node !== "object") return node;

  const el = node as {
    props?: { style?: Record<string, unknown>; children?: unknown };
  };
  if (!el.props) return node;

  const children = el.props.children;
  const kids =
    children === undefined || children === null
      ? []
      : Array.isArray(children)
        ? children
        : [children];

  const style = { ...(el.props.style ?? {}) };

  // satori REQUIRES an explicit display on any element that is not simply
  // holding text, and throws outright without it. Its error says "more than one
  // child node", but that undersells it -- an EMPTY div throws too, which is
  // how a plain accent bar (a positioned 10x220 block of colour) took down
  // three of four slides in a real generation. What renders without a display
  // is only the text-holding case.
  //
  // HTML has no such requirement: a div with several children stacks them, and
  // an empty one is just a box. A model writes ordinary HTML, so this
  // TRANSLATES rather than corrects, and "flex-direction: column" is what
  // preserves the author's meaning -- vertical stacking is what the block
  // layout they wrote would have done. An element that already declares a
  // display is left alone; that was a deliberate choice.
  //
  // Doing this in the renderer rather than the prompt is the point. The
  // requirement is mechanical, and a constraint the machine can enforce should
  // never be left to wording -- stating it in the prompt did not stop the model
  // breaking it on the very next generation.
  const holdsOnlyText =
    kids.length > 0 && kids.every((k) => typeof k === "string");
  if (!style.display && !holdsOnlyText) {
    style.display = "flex";
    if (kids.length > 1 && !style.flexDirection) {
      style.flexDirection = "column";
    }
  }

  return {
    ...node,
    props: { ...el.props, style, children: prepare(children) },
  };
}

/** A design system's photo grade, as multipliers on the source (1 = unchanged). */
export interface PhotoGrade {
  saturate: number;
  contrast: number;
  brightness: number;
}

/**
 * Grade a photograph to the design system's numbers BEFORE it is embedded.
 *
 * Two satori facts force this. It has no CSS `filter`, so the brand's
 * saturation/contrast/brightness cannot be applied in markup and has to be
 * baked into the pixels. And it cannot fetch a relative URL, so the result has
 * to be handed over as a data URI.
 */
export async function gradedPhotoDataUri(
  source: Buffer | string,
  width: number,
  height: number,
  grade: PhotoGrade | null,
): Promise<string> {
  let img = sharp(source).resize(width, height, {
    fit: "cover",
    // Crop toward whatever the image is actually about, rather than its centre
    // -- a room photograph cropped square from the middle loses the subject.
    position: "attention",
  });
  if (grade) {
    img = img
      .modulate({ saturation: grade.saturate, brightness: grade.brightness })
      .linear(grade.contrast, 0);
  }
  const buf = await img.jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/**
 * Stamp the tenant's logo onto a rendered slide.
 *
 * Composited AFTER the design rather than asked for in the markup, for the same
 * reason the photograph is substituted rather than described: placement and
 * size are brand rules, and a model that can put the logo anywhere will
 * eventually put it somewhere wrong. The prompt's job is only to keep the
 * corner clear.
 *
 * THE COLOUR IS CHOSEN FROM THE SLIDE. Optimal Health's supplied mark is solid
 * ink, which the brand document pairs with sage and plaster grounds and
 * replaces with a plaster version on ink -- black on near-black is nothing at
 * all. Rather than require both files, this measures the actual brightness
 * under the logo's box and, on a dark ground, pushes the SAME artwork through
 * in plaster. The geometry is untouched, which is what "use the supplied file"
 * protects; only the ink is swapped, exactly as the document's second file
 * does. A photograph underneath is handled by the same measurement.
 */
export async function stampLogo(
  slidePng: Buffer,
  logoPath: string,
  width: number,
  height: number,
): Promise<Buffer> {
  // The document sets clear space at the height of the dot cluster and a
  // minimum width; on a 1080 field this reads as roughly a fifth of the width,
  // inset by the grid margin.
  const margin = Math.round(width * 0.07);
  const logoW = Math.round(width * 0.19);

  const logo = sharp(logoPath).resize({ width: logoW });
  const { data: logoData, info } = await logo
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const left = width - margin - info.width;
  const top = margin;

  // Mean brightness of the pixels the logo will actually cover.
  const patch = await sharp(slidePng)
    .extract({ left, top, width: info.width, height: info.height })
    .greyscale()
    .raw()
    .toBuffer();
  let sum = 0;
  for (let i = 0; i < patch.length; i++) sum += patch[i];
  const ground = sum / patch.length;

  // Below this the ground is dark enough that an ink mark disappears.
  const onDark = ground < 128;
  let mark = sharp(logoData, {
    raw: { width: info.width, height: info.height, channels: 4 },
  });
  if (onDark) {
    // Push plaster through the mark's own alpha: same shape, brand's light ink.
    const alpha = await sharp(logoData, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .extractChannel(3)
      .toBuffer();
    mark = sharp({
      create: {
        width: info.width,
        height: info.height,
        channels: 3,
        background: "#f2f3ed",
      },
    })
      .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } });
  }

  return sharp(slidePng)
    .composite([{ input: await mark.png().toBuffer(), left, top }])
    .png()
    .toBuffer();
}
