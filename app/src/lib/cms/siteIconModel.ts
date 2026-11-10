/**
 * Which icon a business's website shows in the browser tab and in Google's
 * results. Pure: the file system and the request live in siteIcon.ts.
 *
 * A site that ships its own favicon in its asset folder
 * (public/sites/<slug>/assets/favicon.svg|png|ico) uses it. Otherwise the
 * icon is drawn from the business's logo, or its initial (lib/tenantIcon.ts).
 * Never the platform's own mark: a client's website must not wear ours.
 */

/** In order of preference. SVG stays sharp at every size. */
export const SITE_ICON_FILES = [
  { name: "favicon.svg", type: "image/svg+xml" },
  { name: "favicon.png", type: "image/png" },
  { name: "favicon.ico", type: "image/x-icon" },
] as const;

export type SiteIconFile = (typeof SITE_ICON_FILES)[number];

/** The site's own favicon, given the files present in its asset folder. */
export function pickSiteIconFile(present: readonly string[]): SiteIconFile | null {
  const have = new Set(present.map((n) => n.toLowerCase()));
  return SITE_ICON_FILES.find((f) => have.has(f.name)) ?? null;
}

/** Site slugs are validated on creation; this keeps a bad one off the file system. */
export function isSafeSiteSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug);
}

/**
 * The icon URL a site page links to. The version changes when the source
 * changes, because browsers keep favicons far longer than anything else.
 */
export function siteIconHref(siteSlug: string, version: number): string {
  return `/site-media/${encodeURIComponent(siteSlug)}/icon?v=${Math.round(version)}`;
}
