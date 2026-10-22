/**
 * Where a site is previewed before it has a domain.
 *
 * `/site/<slug>/...` resolves a site by the slug in the URL alone (the
 * "fallback" in lib/cms/resolveHost.ts). Bespoke sites render their own HTML
 * and scripts verbatim, so that path must NOT be served on the app host: the
 * staff session cookie lives there, and one business's page script would run
 * against every other business's staff who opened the link. Previews are
 * served from a separate origin that never carries that cookie, and the app
 * host sends `/site/...` there.
 *
 * Pure and edge-safe: the middleware runs it.
 */

/** The three variables this reads, from process.env or a test object. */
export type PreviewEnv = Record<string, string | undefined>;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The staff app's host (from APP_URL), or null when it is not configured. */
export function appHost(env: PreviewEnv): string | null {
  return hostOf(env.APP_URL);
}

/**
 * The host previews are served from: SITE_PREVIEW_HOST when set, else the
 * service's own Railway domain when that is not the app host. Null means no
 * separate origin exists (local development), and previews stay where they are.
 */
export function previewHost(env: PreviewEnv): string | null {
  const explicit = hostOf(env.SITE_PREVIEW_HOST);
  if (explicit) return explicit;
  const railway = hostOf(env.RAILWAY_PUBLIC_DOMAIN);
  if (railway && railway !== appHost(env)) return railway;
  return null;
}

/** Whether a request on `host` for `/site/...` should be sent to the preview origin. */
export function shouldSendToPreview(host: string | null, env: PreviewEnv): boolean {
  const app = appHost(env);
  const preview = previewHost(env);
  return Boolean(host && app && preview && host.toLowerCase() === app && preview !== app);
}
