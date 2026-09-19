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
.cms-shell{max-width:860px;margin:0 auto;padding:clamp(72px,11vw,150px) 22px clamp(72px,10vw,130px)}
.cms-shell>*+*{margin-top:1.1em}
.cms-prose{line-height:1.75;font-size:17px}
.cms-prose h2{margin:1.9em 0 .55em;line-height:1.15}
.cms-prose h3{margin:1.5em 0 .45em;line-height:1.2}
.cms-prose p,.cms-prose ul,.cms-prose ol,.cms-prose blockquote{margin:0 0 1.15em}
.cms-prose ul,.cms-prose ol{padding-left:1.35em}
.cms-prose li{margin:.35em 0}
.cms-prose img{max-width:100%;height:auto;border-radius:8px;display:block;margin:1.8em 0}
.cms-prose a{text-decoration:underline;text-underline-offset:3px}
.cms-prose blockquote{padding-left:1em;border-left:2px solid currentColor;opacity:.85}
.cms-list{display:grid;gap:clamp(26px,4vw,40px)}
.cms-list a{text-decoration:none;color:inherit;display:block}
.cms-list h2{margin:0 0 .3em;line-height:1.15}
.cms-list time{display:block;font-size:13px;opacity:.6;margin-bottom:.5em}
.cms-list p{margin:0;opacity:.85;line-height:1.6}
.cms-list article{padding-bottom:clamp(26px,4vw,40px);border-bottom:1px solid currentColor;border-color:color-mix(in srgb, currentColor 18%, transparent)}
.cms-list li:last-child article{border-bottom:0}
.cms-back{display:inline-block;font-size:14px;opacity:.7;text-decoration:none}
.cms-back:hover{opacity:1}
@media(max-width:600px){.cms-prose{font-size:16px}}
`;
