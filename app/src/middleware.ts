import { NextResponse, type NextRequest } from "next/server";

// "/open" is the platform "Open business" token handoff: pre-session (no
// cookie yet when it's first hit) but does nothing without a valid one-time
// token — see app/open/route.ts.
const PUBLIC_PATHS = ["/login", "/accept-invite", "/open"];
// Logo is shown on the (logged-out) login screen and isn't sensitive.
// The WhatsApp webhook is a server-to-server callback; it's secret-verified
// inside the route handler.
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/leads/inbound",
  "/api/site-demo-lead", // clientflow.ie demo form → ClientFlow-tenant lead (rate-limited, no key)
  "/api/branding/logo",
  "/api/whatsapp/webhook",
  "/api/cron/", // self-authorizes via CRON_SECRET or an admin session
  "/api/platform/", // self-authorizes: service key + platform-admin session
  "/api/health", // unauthenticated liveness probe (control-DB ping; leaks nothing) — must not 307→/login for uptime monitors
];

// Host → site-slug map for serving public CMS sites at their domain root. The
// edge runtime can't read SQLite, so production host routing uses this env var
// (the Domains admin tells you what to set), e.g.
// CMS_SITE_HOSTS="renovacellular.ie=renova,www.renovacellular.ie=renova"
function parseSiteHosts(v?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v) return out;
  for (const pair of v.split(",")) {
    const [h, s] = pair.split("=");
    if (h && s) out[h.trim().toLowerCase()] = s.trim();
  }
  return out;
}
const SITE_HOSTS = parseSiteHosts(process.env.CMS_SITE_HOSTS);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Expose path + host to server components (root layout uses x-pathname to
  // decide admin-shell vs public-site rendering; the edge can't reach SQLite,
  // so precise host→site resolution happens server-side in resolveHost).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
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
    return NextResponse.next();
  }

  // Mapped public domain → rewrite host-root requests to the site mount.
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const mappedSlug = SITE_HOSTS[host];
  if (
    mappedSlug &&
    !pathname.startsWith("/site/") &&
    !pathname.startsWith("/site-media/") &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/f/") && // public form share links must resolve on a client's own mapped domain too
    !pathname.startsWith("/u/") && // public unsubscribe links must resolve on a client's own mapped domain too
    pathname !== "/sitemap.xml" &&
    pathname !== "/robots.txt"
  ) {
    const url = req.nextUrl.clone();
    url.pathname = `/site/${mappedSlug}${pathname === "/" ? "" : pathname}`;
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
