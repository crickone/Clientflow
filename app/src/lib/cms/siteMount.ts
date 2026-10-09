/**
 * Imported bespoke sites store their internal links under the preview mount,
 * `/site/<slug>/...` (tools/lib/siteHtml.cjs), because that is where they are
 * first viewed. On the client's own verified domain the site is served at the
 * root, so those links would show visitors addresses like
 * www.client.ie/site/client/about. This rewrites them to the root at render
 * time; the stored HTML is unchanged, so the preview keeps working.
 *
 * Only attribute values and CSS url(...) are touched: a link starts right
 * after a quote or an opening bracket. `/sites/<slug>/` (static assets, plural)
 * never matches. Pure.
 */
export function stripSiteMount(html: string, slug: string): string {
  if (!html || !slug) return html;
  const safe = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(["'(])/site/${safe}(?:/|(?=["'?#)]))`, "g");
  return html.replace(re, (_m, open: string) => `${open}/`);
}
