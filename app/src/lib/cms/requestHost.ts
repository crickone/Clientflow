import "server-only";

import { headers } from "next/headers";

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
  const h = headers();
  return h.get(SITE_HOST_HEADER) ?? h.get("host");
}
