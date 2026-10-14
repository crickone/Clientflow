/**
 * Photographs for a page the platform generates (a campaign landing page),
 * taken from the client's own website rather than stock or AI: the page whose
 * address or title best matches what the campaign is about, then the home
 * page. Pure, so the choice can be tested.
 */

export type PhotoPage = { path: string; title: string; html: string };

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
// Logos, icons and marks are not photographs.
const NOT_A_PHOTO = /(logo|icon|favicon|sprite|badge|mark|avatar|placeholder)[^/]*$|\.svg(\?|$)|^data:/i;

/** The photographs on a page, in order, without repeats. */
export function photosIn(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(IMG_SRC)) {
    const src = m[1].trim();
    if (!src || NOT_A_PHOTO.test(src) || out.includes(src)) continue;
    out.push(src);
  }
  return out;
}

const STOP = new Set([
  "the", "and", "for", "with", "off", "every", "your", "our", "black", "friday", "cyber", "monday", "christmas", "xmas",
  "sale", "offer", "offers", "deal", "deals", "special", "campaign", "spring", "summer", "autumn", "winter", "new", "year",
]);

/** The words a campaign is about: "Black Friday Massage 2026" -> ["massage"]. */
export function topicWords(...texts: string[]): string[] {
  const words = texts
    .join(" ")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)];
}

function score(page: PhotoPage, words: string[]): number {
  const path = page.path.toLowerCase();
  const title = page.title.toLowerCase();
  let s = 0;
  for (const w of words) {
    const stem = w.replace(/s$/, "");
    if (path.split(/[^a-z0-9]+/).some((seg) => seg && (seg === w || seg === stem || seg.startsWith(stem)))) s += 3;
    else if (title.includes(stem)) s += 1;
  }
  return s;
}

/**
 * Up to `max` photographs: from the best-matching pages first (a blog post
 * counts for less than a service page), then the home page, then anywhere.
 */
export function pickPhotos(pages: PhotoPage[], words: string[], max = 4): string[] {
  const ranked = pages
    .map((p) => ({ p, s: score(p, words) - (/\bblog\b/.test(p.path) ? 1 : 0) }))
    .sort((a, b) => b.s - a.s || (a.p.path === "/" ? -1 : 0));
  const home = pages.find((p) => p.path === "/");
  const order = [...ranked.filter((r) => r.s > 0).map((r) => r.p), ...(home ? [home] : []), ...pages];
  const out: string[] = [];
  for (const page of order) {
    for (const src of photosIn(page.html)) {
      if (out.length >= max) return out;
      if (!out.includes(src)) out.push(src);
    }
  }
  return out;
}
