/**
 * CMS_SITE_HOSTS ("host=slug,host=slug") maps a public hostname to the CMS
 * site it serves. The middleware uses it to route a mapped domain to its site
 * (the edge cannot read SQLite); robots.txt and sitemap.xml use it too, so a
 * domain the operator mapped here is treated as that site everywhere, not only
 * when it is also verified under the site's Domains. Pure: edge-safe.
 */
export function parseSiteHosts(v?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v) return out;
  for (const pair of v.split(",")) {
    const [h, s] = pair.split("=");
    if (h && s) out[h.trim().toLowerCase()] = s.trim();
  }
  return out;
}

/** The site slug CMS_SITE_HOSTS maps this host to, or null. */
export function envSiteSlugForHost(host: string | null | undefined, env: string | undefined = process.env.CMS_SITE_HOSTS): string | null {
  if (!host) return null;
  return parseSiteHosts(env)[host.split(":")[0].toLowerCase()] ?? null;
}
