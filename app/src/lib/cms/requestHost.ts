import "server-only";

import { headers, type UnsafeUnwrappedHeaders } from "next/headers";

import { SITE_HOST_HEADER } from "./proxyHost";

/**
 * The hostname a PUBLIC request is for: the client domain when the request
 * came through the Cloudflare Worker (the middleware sets the header only
 * after checking the Worker's secret, and strips any other copy), otherwise
 * the Host header. Every public site route resolves its site from this, never
 * from Host directly -- behind the Worker, Host is the Railway service's own
 * name. See lib/cms/proxyHost.ts.
 */
export function siteRequestHost(): string | null {
  const h = (/* @next-codemod-ignore sync request access still works in Next 15 (dev warning only); making this helper and its callers async is a separate migration */
  headers() as unknown as UnsafeUnwrappedHeaders);
  return h.get(SITE_HOST_HEADER) ?? h.get("host");
}
