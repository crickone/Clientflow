import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Font bytes for satori.
 *
 * satori rasterises server-side with no browser, so a CSS font stack means
 * nothing to it -- it needs the actual file. A face that fails to load does not
 * error; the design renders in a fallback and looks subtly wrong, which is the
 * failure this module exists to make impossible.
 *
 * The faces live in `public/fonts` (already served, already copied into the
 * runtime image) and are read once and cached for the process's life.
 */
export interface DesignFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
}

const WEIGHTS = [400, 500, 600, 700] as const;
const cache = new Map<string, DesignFont[]>();

/**
 * Families with real per-weight bytes on disk. Inter ships as the four TTFs
 * it always did; the rest are fontsource WOFFs fetched by
 * scripts/fetch-design-fonts.mjs (satori reads TTF/OTF/WOFF, not WOFF2).
 * Nebula and ClashDisplay also sit in public/fonts but ship as a single file
 * each (a variable axis and two styles), which satori cannot weight-match --
 * adding either means splitting it into static instances first. A design
 * system naming anything not listed here falls back to Inter rather than
 * rendering in a silent default.
 */
export const AVAILABLE_FAMILIES = [
  "Inter",
  "Playfair Display",
  "Space Grotesk",
  "Manrope",
  "Archivo",
  "Fraunces",
  "Anton",
] as const;
export type DesignFamily = (typeof AVAILABLE_FAMILIES)[number];

export const DEFAULT_FAMILY: DesignFamily = "Inter";

/** File on disk for a family at a weight. Inter predates the fontsource
 *  naming; everything after it follows fontsource's exactly. */
const FILE: Record<DesignFamily, (weight: number) => string> = {
  Inter: (w) => `Inter-${w}.ttf`,
  "Playfair Display": (w) => `playfair-display-latin-${w}-normal.woff`,
  "Space Grotesk": (w) => `space-grotesk-latin-${w}-normal.woff`,
  Manrope: (w) => `manrope-latin-${w}-normal.woff`,
  Archivo: (w) => `archivo-latin-${w}-normal.woff`,
  Fraunces: (w) => `fraunces-latin-${w}-normal.woff`,
  // Anton has no weight axis at all -- one very condensed, very heavy cut is
  // the whole typeface. Every weight maps to that one file, so a heading
  // asking for 700 gets Anton rather than silently falling back to a default.
  Anton: () => "anton-latin-400-normal.woff",
};

export function resolveFamily(family: string | null | undefined): DesignFamily {
  const name = (family ?? "").trim();
  return (AVAILABLE_FAMILIES as readonly string[]).includes(name)
    ? (name as DesignFamily)
    : DEFAULT_FAMILY;
}

async function loadFamily(name: DesignFamily): Promise<DesignFont[]> {
  const hit = cache.get(name);
  if (hit) return hit;
  const dir = path.join(process.cwd(), "public", "fonts");
  // Read each distinct file once: a single-cut face like Anton maps every
  // weight to the same path, and reading it four times would be four times the
  // I/O for identical bytes.
  const bytes = new Map<string, Promise<Buffer>>();
  const fonts = await Promise.all(
    WEIGHTS.map(async (weight) => {
      const file = FILE[name](weight);
      if (!bytes.has(file)) bytes.set(file, readFile(path.join(dir, file)));
      return {
        name,
        data: await bytes.get(file)!,
        weight,
        style: "normal" as const,
      };
    }),
  );
  cache.set(name, fonts);
  return fonts;
}

/**
 * Font bytes for a render. Pass a second family to load a DISPLAY/BODY PAIR --
 * satori takes several families in one array and matches on the font-family
 * each element names, which is what lets a design system set a serif headline
 * over a sans body (the move that makes an editorial direction read as
 * editorial rather than as one face at two sizes).
 *
 * Passing the same family twice, or omitting the second, loads it once.
 */
export async function loadDesignFonts(
  family: string = DEFAULT_FAMILY,
  bodyFamily?: string | null,
  altFamily?: string | null,
): Promise<DesignFont[]> {
  const wanted = [
    resolveFamily(family),
    ...(bodyFamily ? [resolveFamily(bodyFamily)] : []),
    ...(altFamily ? [resolveFamily(altFamily)] : []),
  ];
  // Distinct families only: a system naming the same face twice must not pay
  // for it twice, and satori does not want a family registered more than once.
  const unique = [...new Set(wanted)];
  const loaded = await Promise.all(unique.map(loadFamily));
  return loaded.flat();
}
