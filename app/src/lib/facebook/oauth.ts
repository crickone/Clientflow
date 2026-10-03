import "server-only";

import { getAppBaseUrl } from "@/lib/appUrl";

/**
 * Raw Facebook (Meta) OAuth 2.0 — no SDK, mirroring lib/google/oauth.ts. Phase 1
 * of the native Meta integration: a client connects their Page(s) so leads flow
 * in instantly via the leadgen webhook. Fail-closed — facebookConfigured() is
 * false until FACEBOOK_APP_ID + FACEBOOK_APP_SECRET are set, so the connect flow
 * is inert until the operator wires the Meta app (same shape as googleConfigured
 * / Mailgun).
 *
 * Scopes: pages_show_list (list the user's Pages), pages_read_engagement +
 * pages_manage_metadata (subscribe a Page to our webhook), leads_retrieval (read
 * a lead's field data), business_management (Business-managed Pages), and for
 * scheduled posting pages_manage_posts + instagram_basic +
 * instagram_content_publish (lib/social/publisher.ts). All require Meta App
 * Review (Advanced Access) to work for Pages the app's own roles don't manage.
 */

const GRAPH_VERSION = "v21.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

export const FACEBOOK_SCOPES = [
  // Pages + lead ads
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "leads_retrieval",
  "business_management",
  // Posting to the Page and its linked Instagram account
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
].join(",");

export function facebookConfigured(): boolean {
  return Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
}

export function getRedirectUri(): string {
  return process.env.FACEBOOK_REDIRECT_URI || `${getAppBaseUrl()}/api/facebook/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID ?? "",
    redirect_uri: getRedirectUri(),
    response_type: "code",
    state,
  });
  // A Business-type app on Facebook Login for Business asks for a configuration
  // (set up in the app dashboard, holding the permissions above) rather than a
  // raw scope list. Fall back to `scope` until one is configured.
  const configId = process.env.FACEBOOK_LOGIN_CONFIG_ID;
  if (configId) {
    params.set("config_id", configId);
    params.set("override_default_response_type", "true");
  } else {
    params.set("scope", FACEBOOK_SCOPES);
  }
  return `${OAUTH_DIALOG}?${params.toString()}`;
}

/**
 * OAuth code → SHORT-lived user token → LONG-lived user token (~60 days). The
 * long-lived user token enumerates Pages; each Page then yields its own
 * long-lived Page token (which doesn't expire while the user's grant stands).
 * Throws on any failure — the callback catches + redirects with an error, like
 * the Gmail callback. The app secret never appears in a thrown message.
 */
export async function exchangeCodeForLongLivedUserToken(code: string): Promise<string> {
  const shortRes = await fetch(
    `${GRAPH_BASE}/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID ?? "",
        client_secret: process.env.FACEBOOK_APP_SECRET ?? "",
        redirect_uri: getRedirectUri(),
        code,
      }),
  );
  if (!shortRes.ok) throw new Error(`Facebook code exchange failed (${shortRes.status})`);
  const short = (await shortRes.json()) as { access_token?: string };
  if (!short.access_token) throw new Error("Facebook code exchange returned no token");

  const longRes = await fetch(
    `${GRAPH_BASE}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: process.env.FACEBOOK_APP_ID ?? "",
        client_secret: process.env.FACEBOOK_APP_SECRET ?? "",
        fb_exchange_token: short.access_token,
      }),
  );
  if (!longRes.ok) throw new Error(`Facebook long-lived token exchange failed (${longRes.status})`);
  const long = (await longRes.json()) as { access_token?: string };
  if (!long.access_token) throw new Error("Facebook long-lived exchange returned no token");
  return long.access_token;
}
