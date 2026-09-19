/**
 * The one definition of how a bespoke site's static HTML becomes a CMS page.
 *
 * Both importers depend on this: tools/import-site.cjs (a local database) and
 * tools/push-site-to-prod.cjs (the Railway volume). They MUST agree — a page
 * pushed to production that differs from the one imported locally is a bug
 * nobody notices until a client looks at their own website, so the transform
 * lives here once rather than twice.
 */
const fs = require("fs");
const path = require("path");

// Design mockups and ad-library scrapes sit in the same folder as the real
// pages; they are working material, not pages of the website.
const EXCLUDE = /(_Ad_Library_|mockup-)/i;

const m1 = (re, s) => (s.match(re) || [])[1] || null;

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/**
 * Rewrite a page's URLs for the CMS: asset folders become the site's
 * namespaced public path, and internal *.html links become CMS site paths
 * (so blog.html lands on /site/<slug>/blog rather than 404ing).
 */
const rewrite = (html, slug) =>
  html
    .replace(/(["'(])(assets|logo|fonts)\//g, `$1/sites/${slug}/$2/`)
    .replace(/href="([a-z0-9-]+)\.html(#[^"]*)?"/gi, (_full, n, frag) => {
      const f = frag || "";
      return n === "index" ? `href="/site/${slug}${f}"` : `href="/site/${slug}/${n}${f}"`;
    });

/**
 * Read a site folder and return one record per page, in the shape the `pages`,
 * `content_blocks` and `seo_meta` upserts all want. Sorted by path so two runs
 * over the same folder produce byte-identical output and a diff means a real
 * content change.
 */
function readSitePages(dir, slug) {
  const pages = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".html") && !EXCLUDE.test(f))) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const base = file.replace(/\.html$/, "");
    const styles = (raw.match(/<style[\s\S]*?<\/style>/gi) || []).join("\n");
    const gfonts = (raw.match(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/gi) || []).join("\n");
    const body = m1(/<body[^>]*>([\s\S]*?)<\/body>/i, raw) || "";
    pages.push({
      key: base,
      path: base === "index" ? "/" : `/${base}`,
      title: decode((m1(/<title>([\s\S]*?)<\/title>/i, raw) || base).trim()),
      desc: decode((m1(/<meta\s+name="description"\s+content="([\s\S]*?)"/i, raw) || "").trim()),
      body: rewrite(`${gfonts}\n${styles}\n${body}`, slug),
    });
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));
  return pages;
}

module.exports = { EXCLUDE, m1, decode, rewrite, readSitePages };
