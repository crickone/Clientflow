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
  // the same object. decodeTextNodes preserves that structure exactly.
  const nodes = decodeTextNodes(toNodes(html)) as Parameters<SatoriFn>[0];
  const svg = await satori(nodes, { width, height, fonts });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Decode HTML entities in TEXT ONLY, after parsing.
 *
 * satori-html's parser leaves entities alone, so "&middot;" reaches the canvas
 * as the six literal characters -- caught by rendering a slide and looking at
 * it. A model writes entities freely ("&amp;", "&rsquo;", "&mdash;"), so this
 * cannot be left to the prompt.
 *
 * It runs AFTER parsing, and only on text nodes, which is the whole point:
 * decoding the raw string first would turn an escaped "&lt;div&gt;" into a real
 * element and let content become markup.
 */
function decodeTextNodes(node: unknown): unknown {
  if (typeof node === "string") return decodeHTML(node);
  if (Array.isArray(node)) return node.map(decodeTextNodes);
  if (node && typeof node === "object") {
    const el = node as { props?: { children?: unknown } };
    if (el.props && "children" in el.props) {
      return {
        ...node,
        props: { ...el.props, children: decodeTextNodes(el.props.children) },
      };
    }
  }
  return node;
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
