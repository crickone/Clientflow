/**
 * AdonisAgent client-domain proxy (Cloudflare Worker).
 *
 * Every client domain (www.optimalhealthatinspire.ie, ...) is a Cloudflare
 * for SaaS custom hostname on the adonisagent.ie zone. This Worker runs on
 * the zone's catch-all route (`*\/*`) and forwards each request to the one
 * Railway service, telling the app which domain the visitor typed and proving,
 * with a shared secret, that the request came through here. The app trusts
 * that domain only with the secret: see app/src/lib/cms/proxyHost.ts.
 *
 * Variables (Worker > Settings > Variables):
 *   ORIGIN      e.g. https://clientflow-production-ee94.up.railway.app
 *   PROXY_KEY   secret; the same value as SITES_PROXY_SECRET on Railway
 *
 * Deploy: Workers & Pages > Create > paste this file, add the variables,
 * then add the route `*\/*` on the adonisagent.ie zone (Settings > Domains &
 * Routes). Re-paste after any change to this file.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    // The platform's own names are not client domains: leave them to their
    // own DNS records rather than looping them back through here.
    if (host === "adonisagent.ie" || host.endsWith(".adonisagent.ie")) {
      return fetch(request);
    }

    const origin = new URL(env.ORIGIN);
    const target = new URL(url.pathname + url.search, origin);

    const headers = new Headers(request.headers);
    headers.set("x-adonis-site-host", host);
    headers.set("x-adonis-proxy-key", env.PROXY_KEY);
    headers.set("x-forwarded-proto", "https");
    // The visitor's real address, first, so rate limits count visitors and
    // not Cloudflare.
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) headers.set("x-forwarded-for", ip);
    headers.delete("host");

    const res = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    // A redirect the app wrote with its own (Railway) name goes back out on
    // the client's domain.
    const location = res.headers.get("location");
    if (location) {
      try {
        const loc = new URL(location, target);
        if (loc.host === origin.host) {
          loc.host = host;
          loc.protocol = "https:";
          const out = new Response(res.body, res);
          out.headers.set("location", loc.toString());
          return out;
        }
      } catch {
        // not a URL; pass it through as-is
      }
    }
    return res;
  },
};
