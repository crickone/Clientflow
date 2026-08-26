import "server-only";

/**
 * Content-gap analysis's crawler — the ONLY file in this feature that
 * touches a competitor's actual website. Two exported entry points:
 *   - `discoverUrls(baseUrl)`  — find candidate content-page URLs on a site
 *     (sitemap.xml first, homepage `<a href>` links as a fallback).
 *   - `fetchPage(url)`         — fetch ONE page's raw HTML.
 * `lib/research/contentScan.ts` (the scan orchestrator) is the only caller;
 * it runs `discoverUrls` once per competitor, then loops `fetchPage` over
 * the result (pacing itself with `politeDelay` between calls — see that
 * export's own doc comment for why the delay lives here but the LOOP
 * doesn't).
 *
 * Every network call in this file shares one contract, matching the
 * brief's "robust + polite + fail-soft" requirement for hitting external
 * sites:
 *   - `~8s` per-request timeout via AbortController (`FETCH_TIMEOUT_MS`).
 *   - A descriptive `User-Agent` (`USER_AGENT`) — never masquerades as a
 *     browser.
 *   - A `~500KB` per-response cap (`MAX_PAGE_BYTES`), enforced by actually
 *     STOPPING the download once the cap is hit (reading `res.body` via its
 *     stream reader and cancelling it), not just truncating a fully-
 *     downloaded string after the fact — genuinely polite, not just
 *     memory-bounded.
 *   - `text/html` only for actual pages (`fetchPage`) — a declared
 *     non-html/xml content-type is rejected; a response with NO
 *     content-type header at all is still accepted (some misconfigured
 *     sites omit it, and this file has already filtered the URL down to a
 *     same-origin, non-asset-extension path by that point).
 *   - NEVER throws — a timeout, a non-2xx response, a network error, or a
 *     malformed URL all resolve to `null` (fetchPage) or `[]`
 *     (discoverUrls), exactly like places.ts's contract for the exact same
 *     reason: one bad site must never abort a scan.
 *   - SSRF guard (`isPrivateHost`) — refuses an internal/private target
 *     (localhost, loopback, RFC-1918, 169.254 metadata, IPv6 local) before
 *     any network call, AND re-checks the response's final post-redirect URL.
 *     A sitemap INDEX's child `<loc>`s are additionally same-origin-filtered
 *     (`sameOrigin`) before being fetched, since they don't pass through
 *     `filterAndCapUrls` first the way page URLs do.
 *   - `SAME_HOST_DELAY_MS` (~250ms) between same-host requests — see
 *     `politeDelay` below.
 *
 * URL discovery, in order:
 *   1. `robots.txt` — parsed best-effort for `Disallow` prefixes
 *      (`parseRobotsDisallow`); every candidate URL is later dropped if it
 *      matches one (`isBlockedByRobots`). No robots.txt / a failed fetch ->
 *      an empty disallow list (nothing blocked), never a hard failure.
 *   2. `sitemap.xml` — `<loc>` URLs extracted by regex (`parseSitemapLocs`,
 *      works for both a `<urlset>` of pages and a `<sitemapindex>` of child
 *      sitemaps — both use the same tag). A sitemap INDEX
 *      (`isSitemapIndex`) has its child sitemaps fetched too, capped at
 *      `MAX_CHILD_SITEMAPS`, each result's `<loc>`s pooled together.
 *   3. Homepage `<a href>` links (`extractLinks`) — ONLY tried when the
 *      sitemap step yielded nothing (no sitemap.xml, empty, or fully
 *      filtered away); the homepage itself is always included as a
 *      candidate too.
 * Every URL from either path is funnelled through `filterAndCapUrls`:
 * same-origin http(s) only, non-content extensions dropped
 * (`isNonContentUrl`), robots-blocked paths dropped, deduped, capped at
 * `MAX_PAGES_PER_SITE` (40).
 *
 * The pure parsing/filtering pieces (`parseRobotsDisallow`,
 * `isBlockedByRobots`, `isNonContentUrl`, `parseSitemapLocs`,
 * `isSitemapIndex`, `extractLinks`, `filterAndCapUrls`) are exported
 * specifically so crawl.test.ts can exercise them with literal XML/HTML
 * strings — zero network, zero mocking. `discoverUrls`/`fetchPage`
 * themselves are tested the same way places.ts's client functions are
 * (places.test.ts): swap `globalThis.fetch` for the duration of one
 * scenario, assert on both the result and the exact requests made.
 */

export const USER_AGENT = "AdonisAgentBot/1.0 (+https://app.adonisagent.ie)";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_PAGE_BYTES = 500_000; // ~500KB
export const MAX_PAGES_PER_SITE = 40;
const MAX_CHILD_SITEMAPS = 3; // bounds a sitemap INDEX's fan-out; small on purpose (keeps a single discoverUrls call bounded even for a large site)
export const SAME_HOST_DELAY_MS = 250;

/** A shared delay between requests to the SAME host — used both internally (between this file's own robots/sitemap/child-sitemap/homepage requests) and by the caller (contentScan.ts paces its `fetchPage` loop with it too, since that loop lives outside this file). Exported so both sides use the identical constant. */
export function politeDelay(ms: number = SAME_HOST_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── pure parsing / filtering (unit-tested with literal strings, no network) ──

/**
 * Best-effort robots.txt reader: collects every `Disallow:` value that
 * applies to `User-agent: *` OR a UA line naming this bot (case-insensitive
 * substring match on "adonisagentbot"). Deliberately simple — no
 * `Allow:`-overrides-`Disallow:` precedence, no wildcard/`$` support, no
 * per-UA-group specificity beyond "does this group apply to us at all" —
 * matching the brief's "respect robots.txt Disallow, best-effort", not a
 * spec-complete robots.txt parser.
 */
export function parseRobotsDisallow(robotsTxt: string): string[] {
  const disallow: string[] = [];
  let relevant = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "user-agent") {
      relevant = value === "*" || value.toLowerCase().includes("adonisagentbot");
    } else if (key === "disallow" && relevant && value) {
      disallow.push(value);
    }
  }
  return disallow;
}

/** True if `path` (a URL pathname) starts with any of the given robots.txt Disallow prefixes. A blank/`"/"`-only disallow list from a site that disallows everything IS respected (an empty string prefix is never pushed by parseRobotsDisallow in the first place, since it checks `value` truthiness). */
export function isBlockedByRobots(path: string, disallow: string[]): boolean {
  return disallow.some((prefix) => prefix.length > 0 && path.startsWith(prefix));
}

const NON_CONTENT_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".bmp",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".xml",
  ".rss",
  ".zip",
  ".rar",
  ".mp4",
  ".mp3",
  ".wav",
  ".avi",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
];

/** True for a URL this crawler should never treat as a content page: a non-http(s) scheme (mailto:/tel:/javascript:/etc.), or a path ending in a known non-content file extension. Malformed URLs also read as "non-content" (nothing sane to crawl). */
export function isNonContentUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const lowerPath = u.pathname.toLowerCase();
  return NON_CONTENT_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

/**
 * SSRF guard — true for a hostname the crawler must NEVER fetch: localhost,
 * loopback, RFC-1918 private ranges, link-local (incl. the 169.254.169.254
 * cloud-metadata endpoint), and IPv6 loopback/unspecified/link-local
 * (fe80::/10)/unique-local (fc00::/7). Even though a competitor's website URL
 * comes from Google Places today, a crafted sitemap `<loc>` or an HTTP
 * redirect could otherwise drive a server-side GET at an internal address —
 * `fetchTextCapped` calls this before every fetch AND again on the response's
 * final (post-redirect) URL. This is a LITERAL-host check only: a public
 * hostname that RESOLVES (via DNS) to a private IP is deliberately not caught
 * here — that hardening (a resolve-then-check, or a pinned agent) is a
 * documented follow-up, out of scope for an admin-only, Places-sourced v1.
 * Pure, exported for direct unit testing.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 loopback / unspecified / link-local (fe80::/10) / unique-local (fc00::/7)
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(h)) return true;
  // IPv4 (also matches an IPv4-mapped IPv6 tail like ::ffff:127.0.0.1)
  const v4 = h.match(/(?:^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/** True if `url` parses and shares `origin` (scheme+host+port). A malformed url -> false. Used to keep a sitemap INDEX's child `<loc>`s (and thus every fetch they drive) on the same site. Pure, exported for unit testing. */
export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Every `<loc>…</loc>` URL in a sitemap XML body — works for both a `<urlset>` (page URLs) and a `<sitemapindex>` (child sitemap URLs), since both use the same tag. Regex-only, no XML parser dependency. */
export function parseSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const url = decodeXmlEntities(m[1].trim());
    if (url) out.push(url);
  }
  return out;
}

/** True if a sitemap XML body is a sitemap INDEX (points at child sitemaps) rather than a plain urlset of pages. */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Same-origin `<a href="…">` links from an HTML page, resolved against `baseUrl` — the homepage-links fallback when no usable sitemap exists. A malformed/relative-but-unresolvable href is skipped, not thrown. Regex-only. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!href) continue;
    try {
      out.push(new URL(href, baseUrl).toString());
    } catch {
      // malformed href — skip
    }
  }
  return out;
}

/**
 * The shared funnel every discovered URL (sitemap- or homepage-link-
 * sourced) is put through before being handed back to the caller:
 * same-origin http(s) only, non-content extensions dropped, robots-blocked
 * paths dropped, `#fragment`s normalised away (a `#`-only difference is the
 * same page), deduped, capped at `cap`. Pure — exported for direct unit
 * testing.
 */
export function filterAndCapUrls(urls: string[], origin: string, disallow: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    if (isNonContentUrl(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (isBlockedByRobots(u.pathname, disallow)) continue;
    u.hash = "";
    const normalised = u.toString();
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    out.push(normalised);
    if (out.length >= cap) break;
  }
  return out;
}

// ── network (mocked in tests via globalThis.fetch, same technique as places.ts) ──

type FetchTextResult = { text: string; contentType: string };

/**
 * Fetches `url` with the shared timeout/UA contract, then reads the body
 * via its stream reader, STOPPING (cancelling the underlying response) once
 * `maxBytes` is read rather than downloading the whole thing first — the
 * genuinely-polite half of the ~500KB cap. Each chunk is itself sliced down
 * to whatever's left of the budget BEFORE decoding/appending — not just a
 * check-after-the-fact on `received` — so the cap holds exactly even when a
 * single chunk alone exceeds it (a real socket typically delivers a large
 * body over many smaller chunks, but nothing guarantees that: Node's own
 * `Response` can hand back an entire body as one chunk). Falls back to a
 * plain (post-hoc-capped) `res.text()` on the rare response with no
 * readable `body` stream. `acceptContentType`, when given, rejects a
 * response whose DECLARED `content-type` fails the check; a response with
 * no content-type header at all always passes through (see this file's own
 * doc comment for why). Never throws — any failure (timeout, non-2xx,
 * network error, an aborted/errored stream) resolves to `null`.
 */
async function fetchTextCapped(
  url: string,
  opts: { maxBytes: number; acceptContentType?: (contentType: string) => boolean },
): Promise<FetchTextResult | null> {
  // SSRF guard (before any network): never fetch an internal/private host.
  // An unparseable url has nothing to fetch either.
  try {
    if (isPrivateHost(new URL(url).hostname)) return null;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    // A redirect may have moved us to a different (possibly internal) host —
    // re-check the FINAL url. `res.url` is empty on a synthetic Response (unit
    // tests), which safely skips this second check.
    try {
      if (res.url && isPrivateHost(new URL(res.url).hostname)) return null;
    } catch {
      /* res.url malformed — fall through; the body read below is still capped */
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && opts.acceptContentType && !opts.acceptContentType(contentType)) return null;

    if (!res.body) {
      const full = await res.text();
      return { text: full.slice(0, opts.maxBytes), contentType };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = opts.maxBytes - received;
      const chunk = value.byteLength > remaining ? value.subarray(0, Math.max(remaining, 0)) : value;
      received += chunk.byteLength;
      out += decoder.decode(chunk, { stream: true });
      if (received >= opts.maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    out += decoder.decode();
    return { text: out, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const acceptHtml = (ct: string) => ct.includes("text/html");
const acceptXmlish = (ct: string) => ct.includes("xml") || ct.includes("text/plain") || ct.includes("text/html");

async function fetchRobotsDisallow(origin: string): Promise<string[]> {
  // robots.txt is always tiny in practice; a small cap is plenty and cheap.
  const result = await fetchTextCapped(`${origin}/robots.txt`, { maxBytes: 100_000 });
  return result ? parseRobotsDisallow(result.text) : [];
}

async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const primary = await fetchTextCapped(`${origin}/sitemap.xml`, { maxBytes: MAX_PAGE_BYTES, acceptContentType: acceptXmlish });
  if (!primary) return [];
  if (!isSitemapIndex(primary.text)) return parseSitemapLocs(primary.text);

  // A sitemap INDEX's child `<loc>`s are fetched directly (unlike page URLs,
  // which only reach `fetchPage` AFTER `filterAndCapUrls`), so they must be
  // constrained to the same origin HERE — a crafted index must not drive a
  // fetch at an off-site or internal host (fetchTextCapped's isPrivateHost
  // guard is the second line of defence; this is the first).
  const childUrls = parseSitemapLocs(primary.text)
    .filter((u) => sameOrigin(u, origin))
    .slice(0, MAX_CHILD_SITEMAPS);
  const collected: string[] = [];
  for (const childUrl of childUrls) {
    await politeDelay();
    const child = await fetchTextCapped(childUrl, { maxBytes: MAX_PAGE_BYTES, acceptContentType: acceptXmlish });
    if (child) collected.push(...parseSitemapLocs(child.text));
  }
  return collected;
}

/**
 * Finds candidate content-page URLs on `baseUrl`'s site — sitemap.xml
 * first, homepage `<a href>` links as a fallback — filtered, deduped, and
 * capped at `MAX_PAGES_PER_SITE` (40). See this file's own doc comment for
 * the full step-by-step. `baseUrl` is normalised to its origin first (a
 * deep-linked seed URL still crawls the whole site, not just that one
 * path). A malformed `baseUrl` or a non-http(s) scheme -> `[]`, no network
 * call at all. Never throws.
 */
export async function discoverUrls(baseUrl: string): Promise<string[]> {
  let origin: string;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    origin = parsed.origin;
  } catch {
    return [];
  }

  const disallow = await fetchRobotsDisallow(origin);
  await politeDelay();

  const sitemapUrls = await fetchSitemapUrls(origin);
  if (sitemapUrls.length > 0) {
    const filtered = filterAndCapUrls(sitemapUrls, origin, disallow, MAX_PAGES_PER_SITE);
    if (filtered.length > 0) return filtered;
  }

  await politeDelay();
  const homepage = await fetchTextCapped(origin, { maxBytes: MAX_PAGE_BYTES, acceptContentType: acceptHtml });
  if (!homepage) return [];

  const links = extractLinks(homepage.text, origin);
  return filterAndCapUrls([origin, ...links], origin, disallow, MAX_PAGES_PER_SITE);
}

/**
 * Fetches one page's raw HTML. `text/html` only (a declared non-html
 * content-type is rejected; no content-type header at all still passes —
 * see this file's doc comment), capped at ~500KB, `null` on any failure.
 * Never throws.
 */
export async function fetchPage(url: string): Promise<{ url: string; html: string } | null> {
  const result = await fetchTextCapped(url, { maxBytes: MAX_PAGE_BYTES, acceptContentType: acceptHtml });
  return result ? { url, html: result.text } : null;
}
