import "server-only";

/**
 * Meta Graph API constants. App credentials come from env (set in Phase 0):
 * META_APP_ID, META_APP_SECRET. Pin the version via META_GRAPH_VERSION so a
 * Meta-side version bump is a one-line change, not a code hunt.
 */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const META_APP_ID = process.env.META_APP_ID || "";
export const META_APP_SECRET = process.env.META_APP_SECRET || "";

/** OAuth scopes we request to read Pages + publish to the Page and its IG. */
export const SOCIAL_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
] as const;

/** True once the Meta app credentials are configured (Phase 0 done). */
export function isMetaAppConfigured(): boolean {
  return META_APP_ID.length > 0 && META_APP_SECRET.length > 0;
}
