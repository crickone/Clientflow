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
 * Families with real per-weight bytes on disk. Nebula and ClashDisplay also sit
 * in public/fonts but ship as a single file each (a variable axis and two
 * styles), which satori cannot weight-match -- adding either means splitting it
 * into static instances first. A design system naming anything not listed here
 * falls back to Inter rather than rendering in a silent default.
 */
export const AVAILABLE_FAMILIES = ["Inter"] as const;

export const DEFAULT_FAMILY = "Inter";

export function resolveFamily(family: string | null | undefined): string {
  const name = (family ?? "").trim();
  return (AVAILABLE_FAMILIES as readonly string[]).includes(name)
    ? name
    : DEFAULT_FAMILY;
}

export async function loadDesignFonts(
  family: string = DEFAULT_FAMILY,
): Promise<DesignFont[]> {
  const name = resolveFamily(family);
  const hit = cache.get(name);
  if (hit) return hit;
  const dir = path.join(process.cwd(), "public", "fonts");
  const fonts = await Promise.all(
    WEIGHTS.map(async (weight) => ({
      name,
      data: await readFile(path.join(dir, `${name}-${weight}.ttf`)),
      weight,
      style: "normal" as const,
    })),
  );
  cache.set(name, fonts);
  return fonts;
}
