import "server-only";

import type { TenantDb } from "@/lib/db/tenant";
import { getBlockValue } from "@/lib/cms/blocks";
import { splitPageBody } from "@/lib/cms/pageBody";
import { pages } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";

/**
 * The client's own site furniture — stylesheet, navbar, footer — so pages the
 * CMS generates look like the website they belong to.
 *
 * A bespoke site's design lives entirely inside its imported pages: the
 * `<style>` block IS the design, and the `<header>` IS the navbar. Routes the
 * platform renders itself (the blog index, a blog post, a campaign landing
 * page) had none of that, so they came out as bare white documents with a
 * system font — recognisably not the client's site, sitting on the client's
 * domain. For a gym whose whole site is black and gold, the blog looked like
 * somebody else's.
 *
 * Rather than ask every tenant to configure a theme, this reads the design
 * they already have. One page is nominated as the source (the home page,
 * falling back to whichever published page comes first) and its three zones
 * are reused: the head tokens are the CSS and fonts, the tail tokens are the
 * scripts that make the header sticky and the menu button work, and the
 * header and footer are lifted out of the content between them.
 *
 * Nothing is synthesised. If a site has no header, this returns an empty
 * string for it and the page renders without one, rather than inventing a
 * navbar that does not match anything.
 */
export interface SiteChrome {
  /** The page's own <link> fonts and <style> — the site's entire design. */
  head: string;
  /** The site's <header> markup, or "" if it has none. */
  header: string;
  /** The site's <footer> markup, or "" if it has none. */
  footer: string;
  /**
   * The site's trailing <script> tokens. Included because they are what makes
   * the header stick and the mobile menu open; a navbar that looks right but
   * does not work on a phone is only half the job. Safe to run on a page they
   * were not written for: these scripts guard their own lookups (`if (mb)`,
   * `if (document.querySelector('.hero ...'))`) and fall back to revealing
   * animated elements outright when their library is missing.
   */
  tail: string;
}

const EMPTY: SiteChrome = { head: "", header: "", footer: "", tail: "" };

/** Lift one balanced <header> or <footer> element out of a page's markup. */
function extractElement(html: string, tag: "header" | "footer"): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i").exec(html);
  if (!open) return "";
  const start = open.index;
  let depth = 0;
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  scan.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return "";
}

/**
 * Read a site's chrome. Returns empty strings rather than throwing or null
 * when there is nothing to take: a blog that renders plain is a worse page,
 * not a broken one, and it must never take the route down with it.
 */
export function getSiteChrome(db: TenantDb, siteId: number): SiteChrome {
  try {
    // The home page is the most likely to carry the full navbar and footer;
    // any published page will do if there isn't one.
    const candidates = db
      .select({ id: pages.id, path: pages.path })
      .from(pages)
      .where(and(eq(pages.siteId, siteId), eq(pages.status, "published")))
      .orderBy(asc(pages.path))
      .all();
    if (candidates.length === 0) return EMPTY;
    const source = candidates.find((p) => p.path === "/") ?? candidates[0];

    const block = getBlockValue(db, siteId, source.id, "body");
    if (!block?.value) return EMPTY;

    const zones = splitPageBody(block.value);
    return {
      head: zones.head,
      header: extractElement(zones.content, "header"),
      footer: extractElement(zones.content, "footer"),
      tail: zones.tail,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Layout for CMS-rendered content sitting inside a client's chrome.
 *
 * Deliberately sets NO colours, fonts or borders. The site's own stylesheet
 * is already on the page and styles `body`, `h1`-`h4`, `a` and the rest;
 * anything set here would have to guess at a palette and would be wrong on
 * half the sites. What the site cannot know about is the measure and rhythm
 * of a text page it has never had, so that is all this provides — plus
 * underlines on links inside prose, because most of these designs strip them
 * globally for navigation, which is right there and wrong in an article.
 */
export const CHROME_CONTENT_CSS = `
/* Layout only. The site's own stylesheet is already on the page and owns the
   palette and the typefaces; anything named here would be a guess and wrong
   on half the platform. What a bespoke marketing site has never had is a
   TEXT page and a LIST page, so that is what this provides: measure, rhythm,
   and a grid. Sizes are clamped rather than stepped, so every width between
   the breakpoints is designed for, not just the three anyone tests. */
.cms-shell{max-width:1180px;margin:0 auto;padding:clamp(56px,9vw,120px) clamp(18px,4vw,40px) clamp(64px,9vw,120px)}
.cms-shell--narrow{max-width:760px}

/* Page heading. The site styles h1 for a hero, where the size comes from a
   utility class the CMS has no business borrowing, so the scale is set here. */
.cms-head{margin:0 0 clamp(28px,4vw,52px)}
.cms-head h1{font-size:clamp(38px,7vw,76px);line-height:1.02;margin:0}
.cms-head p{margin:.7em 0 0;max-width:52ch;opacity:.75;line-height:1.6}

/* The index: three across, then two, then one. */
.cms-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(24px,3vw,38px);list-style:none;padding:0;margin:0}
@media(max-width:1000px){.cms-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.cms-grid{grid-template-columns:1fr;gap:30px}}

.cms-card{height:100%}
.cms-card a{display:flex;flex-direction:column;height:100%;text-decoration:none;color:inherit}
.cms-card__media{aspect-ratio:3/2;overflow:hidden;border-radius:10px;margin-bottom:14px}
.cms-card__media img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .6s cubic-bezier(.2,.7,.3,1)}
.cms-card a:hover .cms-card__media img{transform:scale(1.04)}
.cms-card h2{font-size:clamp(19px,2vw,23px);line-height:1.25;margin:0 0 .35em}
.cms-card time{display:block;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;opacity:.55;margin-bottom:.55em}
.cms-card p{margin:0;font-size:15px;line-height:1.6;opacity:.78}
/* A card with no picture keeps its place in the row rather than collapsing. */
.cms-card__media--empty{aspect-ratio:3/2;border-radius:10px;margin-bottom:14px;border:1px solid currentColor;opacity:.13}

/* A post. */
.cms-prose{line-height:1.75;font-size:17px}
.cms-prose h2{font-size:clamp(23px,2.6vw,30px);margin:1.9em 0 .55em;line-height:1.18}
.cms-prose h3{font-size:clamp(19px,2.1vw,23px);margin:1.5em 0 .45em;line-height:1.25}
.cms-prose p,.cms-prose ul,.cms-prose ol,.cms-prose blockquote{margin:0 0 1.15em}
.cms-prose ul,.cms-prose ol{padding-left:1.35em}
.cms-prose li{margin:.35em 0}
.cms-prose img{max-width:100%;height:auto;border-radius:10px;display:block;margin:1.9em 0}
.cms-prose a{text-decoration:underline;text-underline-offset:3px}
.cms-prose blockquote{padding-left:1em;border-left:2px solid currentColor;opacity:.85}
.cms-hero{width:100%;aspect-ratio:16/9;max-height:460px;overflow:hidden;border-radius:12px;margin:26px 0 8px}
.cms-hero img{width:100%;height:100%;object-fit:cover;display:block}
.cms-meta{display:block;font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin-top:.6em}
.cms-back{display:inline-block;font-size:13.5px;letter-spacing:.04em;opacity:.7;text-decoration:none;margin-bottom:1.6em}
.cms-back:hover{opacity:1}

/* Keyboard focus has to be visible. These designs strip underlines from
   links for navigation, and a site that never had a list of article links
   has no rule covering them — so without this, tabbing through the blog
   moves an invisible cursor. currentColor keeps it in the site's palette
   rather than introducing one. */
.cms-shell a:focus-visible{outline:2px solid currentColor;outline-offset:3px;border-radius:3px}

@media(prefers-reduced-motion:reduce){
  .cms-card__media img{transition:none}
  .cms-card a:hover .cms-card__media img{transform:none}
}
@media(max-width:600px){.cms-prose{font-size:16px}}
`;
