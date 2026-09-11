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
 * How far a design's content runs PAST the bottom of its canvas, in pixels.
 * 0 means it fits.
 *
 * Why this is needed at all: satori has no auto-fit. The fixed templates shrink
 * a heading until it fits (autoFitHeading in lib/image/templates), but a
 * designed slide is authored HTML with hard pixel font-sizes, so a model that
 * writes one sentence too many simply gets it cut off at the canvas edge —
 * which is exactly what an operator sees as "the last sentence doesn't finish".
 *
 * How it works, and why this shape: satori does NOT clip at the root. Rendered
 * into a TALLER canvas at the SAME width, overflowing content paints below
 * where the canvas would have ended, and the area past the root stays
 * transparent otherwise. So the test is simply "is anything painted below the
 * canvas line", read off the alpha channel — no background-colour heuristics,
 * which would misfire on a full-bleed photograph. (Established by probe, not
 * assumption: a 40px block reports 0 pixels below the line, the same block at
 * 64px reports 1874.)
 *
 * The width is deliberately left EXACT. Widening the measurement canvas would
 * re-wrap the text and measure a layout that is not the one being rendered.
 * The cost is that horizontal overflow — a long unbroken word pushing past the
 * right edge — is not detected here; vertical is what actually bites, because
 * that is the direction copy grows.
 *
 * This is a SECOND satori pass per slide. That is a real cost, accepted
 * deliberately: it runs inside a generation that already spent seconds on a
 * model call, and it feeds the existing repair loop, so the alternative is
 * shipping the operator a slide with its last line sliced off.
 */
export async function measureOverflowPx(
  html: string,
  width: number,
  height: number,
  fonts: DesignFont[],
  slack = 500,
): Promise<number> {
  const { satori, toNodes } = await loadSatori();
  const nodes = prepare(toNodes(html)) as Parameters<SatoriFn>[0];
  const svg = await satori(nodes, { width, height: height + slack, fonts });
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let painted = 0;
  let lowest = -1;
  for (let y = height; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      // Alpha only. Anything painted below the canvas line is, by definition,
      // content that did not fit.
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        painted++;
        lowest = y;
      }
    }
  }

  // A handful of pixels is antialiasing on a shape that ends exactly at the
  // edge, not a cut-off sentence. Requiring a real cluster keeps the repair
  // loop from being triggered by a rounding artefact.
  if (painted < 32 || lowest < 0) return 0;
  return lowest - height + 1;
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
// The brand document sets clear space at the height of the dot cluster and a
// minimum width; on a 1080 field this reads as roughly a fifth of the width,
// inset by the grid margin.
const LOGO_MARGIN_FRACTION = 0.07;
const LOGO_WIDTH_FRACTION = 0.19;

/** Where the logo lands on a slide, in canvas pixels. */
export interface LogoBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * THE single statement of the logo's geometry: stampLogo composites into it,
 * and the design prompt reserves it.
 *
 * They used to be two separate statements of the same rule, and they
 * disagreed. The prompt asked for "roughly a quarter of the width and a tenth
 * of the height" kept clear -- but the HEIGHT is the logo's own aspect ratio at
 * a 19% width, which for a squarish mark is more than a quarter of the canvas,
 * not a tenth. Anything the model put in the top band (Evidence's running head
 * and its slide counter, in the carousel that exposed this) was told it had
 * room and then had the logo composited straight over it.
 */
export async function logoBox(logoPath: string, width: number): Promise<LogoBox> {
  const margin = Math.round(width * LOGO_MARGIN_FRACTION);
  const w = Math.round(width * LOGO_WIDTH_FRACTION);
  const meta = await sharp(logoPath).metadata();
  // A logo with no readable dimensions is reserved as a square: too much space
  // held back is a composition constraint, too little is a logo on top of type.
  const h =
    meta.width && meta.height ? Math.round((meta.height * w) / meta.width) : w;
  return { left: width - margin - w, top: margin, width: w, height: h };
}

/**
 * The two inks the mark is pushed through, by what it lands on.
 *
 * Both are flattenings of the SAME artwork -- the geometry is untouched, which
 * is what "use the supplied file" protects; only the colour is swapped, exactly
 * as a brand document's second file does. A tenant whose mark is gold and teal
 * gets a solid white version on a dark ground and a solid black one on a light
 * ground, which is what an operator asked for after watching a two-colour
 * wordmark fight a cream dossier page for attention.
 */
export interface LogoMarks {
  /** Pushed through the mark's alpha on a DARK ground. */
  onDark: string;
  /** Pushed through on a LIGHT ground. null keeps the supplied artwork as-is. */
  onLight: string | null;
}

export const DEFAULT_LOGO_MARKS: LogoMarks = {
  onDark: "#f2f3ed",
  onLight: "#0b0b0b",
};

/** Same shape, same alpha, one flat colour. */
function flattened(
  logoData: Buffer,
  info: { width: number; height: number },
  hex: string,
): Promise<Buffer> {
  return sharp(logoData, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extractChannel(3)
    .toBuffer()
    .then((alpha) =>
      sharp({
        create: {
          width: info.width,
          height: info.height,
          channels: 3,
          background: hex,
        },
      })
        .joinChannel(alpha, {
          raw: { width: info.width, height: info.height, channels: 1 },
        })
        .png()
        .toBuffer(),
    );
}

export async function stampLogo(
  slidePng: Buffer,
  logoPath: string,
  width: number,
  height: number,
  marks: LogoMarks = DEFAULT_LOGO_MARKS,
): Promise<Buffer> {
  const margin = Math.round(width * LOGO_MARGIN_FRACTION);
  const logoW = Math.round(width * LOGO_WIDTH_FRACTION);

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
  const ink = onDark ? marks.onDark : marks.onLight;
  const mark = ink
    ? await flattened(logoData, info, ink)
    : await sharp(logoData, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .png()
        .toBuffer();

  return sharp(slidePng)
    .composite([{ input: mark, left, top }])
    .png()
    .toBuffer();
}
