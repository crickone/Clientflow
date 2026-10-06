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
 * instagram_content_publish (lib/social/publisher.ts), DMs pages_messaging +
 * instagram_manage_messages, and ads ads_management + ads_read +
 * pages_manage_ads (lib/facebook/grants.ts holds the token those use). All require Meta App
 * Review (Advanced Access) to work for Pages the app's own roles don't manage.
 */

import { GRAPH_BASE, GRAPH_VERSION } from "./graph";
export { GRAPH_BASE };
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
  // Messenger + Instagram DMs
  "pages_messaging",
  "instagram_manage_messages",
  // Running ads on the business's own ad account
  "ads_management",
  "ads_read",
  "pages_manage_ads",
  // Page + Instagram metrics for the Social dashboard
  "read_insights",
  "instagram_manage_insights",
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

export interface ExchangedToken {
  token: string;
  kind: "system_user" | "user";
  /** Epoch ms, or null when the token never expires (a system-user token). */
  expiresAt: number | null;
  /**
   * The Facebook user (app-scoped id) who made the connection: what Meta's
   * data deletion callback names when that person removes the app.
   */
  fbUserId: string | null;
}

async function tokenRequest(params: Record<string, string>): Promise<string> {
  const res = await fetch(
    `${GRAPH_BASE}/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID ?? "",
        client_secret: process.env.FACEBOOK_APP_SECRET ?? "",
        ...params,
      }),
  );
  // Never put the response body in the error: it can echo request parameters.
  if (!res.ok) throw new Error(`Facebook token exchange failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Facebook token exchange returned no token");
  return body.access_token;
}

/**
 * OAuth code -> the tenant's grant token. With a Login for Business
 * configuration set to "System-user access token" the code yields a
 * business-integration system-user token that never expires. Otherwise it is a
 * short-lived user token, swapped for a long-lived one (~60 days). debug_token
 * tells the two apart and gives the expiry. Throws on any failure (the callback
 * catches); the app secret never appears in a thrown message.
 */
export async function exchangeCode(code: string): Promise<ExchangedToken> {
  let token = await tokenRequest({ redirect_uri: getRedirectUri(), code });
  const info = await inspectToken(token);
  if (info.type !== "SYSTEM_USER") {
    token = await tokenRequest({ grant_type: "fb_exchange_token", fb_exchange_token: token });
    const longInfo = await inspectToken(token);
    return { token, kind: "user", expiresAt: longInfo.expiresAt, fbUserId: info.userId };
  }
  return { token, kind: "system_user", expiresAt: info.expiresAt, fbUserId: info.userId };
}

async function inspectToken(token: string): Promise<{ type: string; expiresAt: number | null; userId: string | null }> {
  const appToken = `${process.env.FACEBOOK_APP_ID ?? ""}|${process.env.FACEBOOK_APP_SECRET ?? ""}`;
  const res = await fetch(`${GRAPH_BASE}/debug_token?` + new URLSearchParams({ input_token: token, access_token: appToken }));
  const body = (await res.json().catch(() => ({}))) as { data?: { type?: string; expires_at?: number; user_id?: string } };
  const exp = body.data?.expires_at;
  return { type: body.data?.type ?? "USER", expiresAt: exp ? exp * 1000 : null, userId: body.data?.user_id ?? null };
}
