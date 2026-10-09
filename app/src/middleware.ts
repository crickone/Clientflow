import { NextResponse, type NextRequest } from "next/server";
import { parseSiteHosts } from "@/lib/cms/siteHostsEnv";
import { PROXIED_SITE_SLUG, PROXY_KEY_HEADER, SITE_HOST_HEADER, trustedProxyHost } from "@/lib/cms/proxyHost";

// "/open" is the platform "Open business" token handoff: pre-session (no
// cookie yet when it's first hit) but does nothing without a valid one-time
// token — see app/open/route.ts.
// "/forgot-password" + "/reset-password" are the staff (operator) password
// reset flow — reached by someone who, by definition, can't sign in yet.
// Each is self-authorizing past this gate: forgot-password's request action
// is enumeration-safe, and reset-password requires the emailed single-use
// token (see lib/userPasswordReset.ts).
const PUBLIC_PATHS = ["/login", "/accept-invite", "/open", "/forgot-password", "/reset-password"];
// Logo is shown on the (logged-out) login screen and isn't sensitive.
// The WhatsApp webhook is a server-to-server callback; it's secret-verified
// inside the route handler.
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/leads/inbound",
  "/api/site-demo-lead", // clientflow.ie demo form → AdonisAgent-tenant lead (rate-limited, no key)
  "/api/campaigns/signup", // public campaign-landing "Sign up" form → host-scoped lead (rate-limited, no key)
  "/api/site/enquiry", // public bespoke-site enquiry form → token-scoped lead (rate-limited, no key; see lib/cms/enquiryToken)
  "/api/branding/logo",
  "/api/whatsapp/webhook",
  "/api/mailgun/webhook", // Mailgun delivery/engagement webhook — server-to-server, HMAC-signature-verified inside the route handler
  "/api/integrations/facebook/leadgen", // Facebook leadgen webhook — server-to-server, X-Hub-Signature-256-verified inside the route handler
  "/api/integrations/meta/data-deletion", // Meta data deletion callback: signed_request-verified inside the route handler
  "/api/integrations/meta/webhook", // Meta webhook (lead ads + Messenger + Instagram DMs) — X-Hub-Signature-256-verified inside the route handler
  "/api/voice/webhook", // ElevenLabs post-call webhook — server-to-server, HMAC-verified inside the route handler
  "/api/cron/", // self-authorizes via CRON_SECRET or an admin session
  "/api/platform/", // self-authorizes: service key + platform-admin session
  "/api/site-events", // public first-party page-view beacon (cookieless, rate-limited, host-verified, always 204)
  "/api/social/render/", // slide images Meta fetches when publishing a post — signed-token-verified inside the route handler
  "/api/social/video/", // video ads Meta fetches when an ad is uploaded — signed-token-verified inside the route handler
  "/api/health", // unauthenticated liveness probe (control-DB ping; leaks nothing) — must not 307→/login for uptime monitors
];

// Host → site-slug map for serving public CMS sites at their domain root. The
// edge runtime can't read SQLite, so production host routing uses this env var
// (the Domains admin tells you what to set), e.g.
// CMS_SITE_HOSTS="renovacellular.ie=renova,www.renovacellular.ie=renova"
const SITE_HOSTS = parseSiteHosts(process.env.CMS_SITE_HOSTS);
// Shared with the Cloudflare Worker that fronts every client domain; see
// lib/cms/proxyHost.ts.
const PROXY_SECRET = process.env.SITES_PROXY_SECRET;


export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Expose path + host to server components (root layout uses x-pathname to
  // decide admin-shell vs public-site rendering; the edge can't reach SQLite,
  // so precise host→site resolution happens server-side in resolveHost).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  // A client domain arriving through the Cloudflare Worker. The site-host
  // header is trusted ONLY with the Worker's secret, and stripped otherwise
  // (and the secret never travels further than this function), so a page
  // reading it can rely on it. See lib/cms/proxyHost.ts.
  const proxiedHost = trustedProxyHost((n) => req.headers.get(n), PROXY_SECRET);
  requestHeaders.delete(SITE_HOST_HEADER);
  requestHeaders.delete(PROXY_KEY_HEADER);
  if (proxiedHost) requestHeaders.set(SITE_HOST_HEADER, proxiedHost);
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Static assets, Next internals, favicon, public files — always allowed.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/fonts") ||
    pathname.startsWith("/logo") ||
    pathname.startsWith("/sites/") || // per-site static assets (public/sites/<slug>/…)
    pathname === "/favicon.ico" ||
    /\.(png|jpe?g|svg|ico|webp|gif|mp4|webm|mov|otf|ttf|woff2?|css|js)$/i.test(pathname)
  ) {
    // pass(), not a bare next(): some of these paths reach a route that reads
    // the site host, and the untrusted copy must be gone by then.
    return pass();
  }

  // Mapped public domain → rewrite host-root requests to the site mount.
  // A host in CMS_SITE_HOSTS names its site directly. A client domain through
  // the Worker does not need to be listed anywhere: it is rewritten under a
  // placeholder slug and the page resolves the site from the verified domain.
  const host = proxiedHost ?? (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const mappedSlug = SITE_HOSTS[host] ?? (proxiedHost ? PROXIED_SITE_SLUG : undefined);
  if (
    mappedSlug &&
    !pathname.startsWith("/site/") &&
    !pathname.startsWith("/site-media/") &&
    !pathname.startsWith("/library-media/") && // shared media library images used inside site pages
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/f/") && // public form share links must resolve on a client's own mapped domain too
    !pathname.startsWith("/u/") && // public unsubscribe links must resolve on a client's own mapped domain too
    pathname !== "/sitemap.xml" &&
    pathname !== "/robots.txt"
  ) {
    const url = req.nextUrl.clone();
    url.pathname = `/site/${mappedSlug}${pathname === "/" ? "" : pathname}`;
    // The root layout reads x-pathname to pick the bare public-site render; with
    // the ORIGINAL path ("/privacy") it took the admin branch and sent every
    // signed-out visitor on a mapped domain to /login. Hand it the rewritten one.
    requestHeaders.set("x-pathname", url.pathname);
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  // Public CMS-served site + its media/sitemap/robots — unauthenticated.
  if (
    pathname.startsWith("/site/") ||
    pathname.startsWith("/site-media/") ||
    pathname.startsWith("/library-media/") || // shared media library (global)
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt"
  ) {
    return pass();
  }

  // Public form share links (`/f/<slug>` render + its `/f/<slug>/submit`
  // handler) — unauthenticated lead-capture pages. Tenant is resolved
  // server-side from the slug (lib/publicForms.ts), never from a session.
  if (pathname.startsWith("/f/")) {
    return pass();
  }

  // Public unsubscribe links (`/u/<token>`) — unauthenticated, self-
  // authorizing: the signed token embeds + verifies the tenant (see
  // lib/marketing/unsubscribeToken.ts), so unlike every other admin route
  // there's no session/cookie to check here at all. Same treatment as the
  // public form share links above.
  if (pathname.startsWith("/u/")) {
    return pass();
  }

  // Public pages and the auth API + the inbound lead webhook (server-to-server).
  if (PUBLIC_PATHS.includes(pathname)) return pass();
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return pass();
  }

  // Client mobile app (`/app`). Its own auth cookie + login page; validation is
  // server-side. The login page, the forgot/set-password reset page, and the
  // client-auth API are public (reached before the member is signed in).
  if (
    pathname === "/app/login" ||
    pathname === "/app/reset" ||
    pathname.startsWith("/api/client-auth/")
  ) {
    return pass();
  }
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    if (!req.cookies.has("cf_client_session")) {
      const url = req.nextUrl.clone();
      url.pathname = "/app/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return pass();
  }

  // Client mobile app API routes (e.g. the assigned-plan document download).
  // Same client session cookie as the /app/* pages above, but these are
  // fetched/opened by API callers rather than navigated to — an HTML redirect
  // to a login PAGE would be the wrong response here, so this is a 401 JSON
  // instead. Without this branch these would fall through to the generic
  // STAFF-session gate below and 307 a signed-in client (who has no staff
  // `clientflow_session` cookie) to the staff /login. Real auth + per-client
  // ownership is still enforced server-side in the route handler either way —
  // this is just the fast edge-runtime gate, same as every other branch here.
  if (pathname.startsWith("/api/app/")) {
    if (!req.cookies.has("cf_client_session")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return pass();
  }

  // Everything else requires the session cookie. Actual validation happens
  // server-side (route handlers / server components) — this is just a fast
  // edge-runtime gate before any heavy work runs.
  const hasCookie = req.cookies.has("clientflow_session");
  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Expose the path to the root layout so it can centrally redirect an
  // authenticated-but-unresolved session (multi-clinic user who hasn't chosen a
  // clinic) to /select-account, without every page needing its own guard. The
  // membership check itself is server-side (DB) in the layout — the edge runtime
  // can't reach SQLite.
  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
