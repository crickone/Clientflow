// Run: npm test -- src/lib/research/crawl.test.ts
//
// Content-gap analysis's crawler (lib/research/crawl.ts). crawl.ts has
// `import "server-only"` but otherwise zero further imports (no @/lib/db,
// no react, no next/navigation) — a leaf module exactly like places.ts — so
// this file needs no Module._load shim either, a plain top-level import,
// mirroring places.test.ts's own structure and technique
// (withMockFetch/check/IIFE) for the network-mocked scenarios below.
//
// Covers:
//   1. The pure parsing/filtering pieces with literal strings, zero network:
//      parseRobotsDisallow, isBlockedByRobots, isNonContentUrl,
//      parseSitemapLocs, isSitemapIndex, extractLinks, filterAndCapUrls.
//   2. discoverUrls / fetchPage against a mocked globalThis.fetch (same
//      technique as places.test.ts): sitemap-first discovery, the sitemap
//      INDEX child-fetch path, the homepage-links fallback, robots.txt
//      Disallow actually excluding a URL end-to-end, the 40-page cap, and
//      "never throws" on a timeout/network error/malformed baseUrl.
import assert from "node:assert/strict";
import {
  parseRobotsDisallow,
  isBlockedByRobots,
  isNonContentUrl,
  parseSitemapLocs,
  isSitemapIndex,
  extractLinks,
  filterAndCapUrls,
  discoverUrls,
  fetchPage,
  USER_AGENT,
  MAX_PAGES_PER_SITE,
} from "./crawl";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

type FetchCall = { url: string; init?: RequestInit };

/** Same technique as places.test.ts: swap globalThis.fetch for the duration of `fn`, recording every call, restoring even if `fn` throws. */
async function withMockFetch<T>(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function xmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
}
function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
function notFound(): Response {
  return new Response("not found", { status: 404 });
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // 1. Pure parsing / filtering
  // ════════════════════════════════════════════════════════════════════

  // ── parseRobotsDisallow / isBlockedByRobots ──
  {
    const robots = [
      "User-agent: *",
      "Disallow: /admin",
      "Disallow: /cart",
      "",
      "# a comment line",
      "User-agent: GPTBot",
      "Disallow: /everything",
    ].join("\n");
    const disallow = parseRobotsDisallow(robots);
    check("parseRobotsDisallow: collects Disallow under User-agent: *", disallow.includes("/admin") && disallow.includes("/cart"));
    check("parseRobotsDisallow: does NOT collect a different bot's group", !disallow.includes("/everything"));
    check("isBlockedByRobots: a matching prefix is blocked", isBlockedByRobots("/admin/users", disallow));
    check("isBlockedByRobots: a non-matching path is not blocked", !isBlockedByRobots("/blog/post-1", disallow));

    const namedForUs = parseRobotsDisallow("User-agent: AdonisAgentBot\nDisallow: /private\n");
    check("parseRobotsDisallow: a group explicitly naming our bot (case-insensitive) applies", namedForUs.includes("/private"));

    const emptyDisallowValue = parseRobotsDisallow("User-agent: *\nDisallow:\n");
    check("parseRobotsDisallow: a blank Disallow value (allow everything) contributes no prefix", emptyDisallowValue.length === 0);

    check("parseRobotsDisallow: no robots.txt content -> []", parseRobotsDisallow("").length === 0);
    check("isBlockedByRobots: an empty disallow list blocks nothing", !isBlockedByRobots("/anything", []));
  }

  // ── isNonContentUrl ──
  {
    check("isNonContentUrl: a .pdf is non-content", isNonContentUrl("https://x.test/brochure.pdf"));
    check("isNonContentUrl: a .jpg is non-content", isNonContentUrl("https://x.test/photo.jpg"));
    check("isNonContentUrl: a .css is non-content", isNonContentUrl("https://x.test/styles.css"));
    check("isNonContentUrl: mailto: is non-content", isNonContentUrl("mailto:hello@x.test"));
    check("isNonContentUrl: tel: is non-content", isNonContentUrl("tel:+353851234567"));
    check("isNonContentUrl: javascript: is non-content", isNonContentUrl("javascript:void(0)"));
    check("isNonContentUrl: a malformed URL is non-content", isNonContentUrl("not a url"));
    check("isNonContentUrl: a normal page URL is content", !isNonContentUrl("https://x.test/services/massage"));
    check("isNonContentUrl: extension check is case-insensitive", isNonContentUrl("https://x.test/BROCHURE.PDF"));
  }

  // ── parseSitemapLocs / isSitemapIndex ──
  {
    const urlset = `<?xml version="1.0"?><urlset><url><loc>https://x.test/a</loc></url><url><loc>https://x.test/b</loc></url></urlset>`;
    check("isSitemapIndex: a urlset is not an index", !isSitemapIndex(urlset));
    check(
      "parseSitemapLocs: extracts every <loc> from a urlset",
      JSON.stringify(parseSitemapLocs(urlset)) === JSON.stringify(["https://x.test/a", "https://x.test/b"]),
    );

    const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://x.test/sitemap-1.xml</loc></sitemap><sitemap><loc>https://x.test/sitemap-2.xml</loc></sitemap></sitemapindex>`;
    check("isSitemapIndex: a sitemapindex IS an index", isSitemapIndex(index));
    check(
      "parseSitemapLocs: also extracts <loc> from an index (child sitemap URLs)",
      JSON.stringify(parseSitemapLocs(index)) === JSON.stringify(["https://x.test/sitemap-1.xml", "https://x.test/sitemap-2.xml"]),
    );

    check("parseSitemapLocs: decodes &amp; inside a <loc>", parseSitemapLocs("<loc>https://x.test/a?b=1&amp;c=2</loc>")[0] === "https://x.test/a?b=1&c=2");
    check("parseSitemapLocs: malformed/empty XML -> []", parseSitemapLocs("not xml at all").length === 0);
    check("parseSitemapLocs: empty string -> []", parseSitemapLocs("").length === 0);
  }

  // ── extractLinks ──
  {
    const html = `<html><body>
      <a href="/services">Services</a>
      <a href="https://x.test/about">About</a>
      <a href="https://other.test/page">Off-site</a>
      <a href="mailto:hi@x.test">Email</a>
      <a href="#section">Jump</a>
      <a>No href at all</a>
    </body></html>`;
    const links = extractLinks(html, "https://x.test");
    check("extractLinks: resolves a relative href against baseUrl", links.includes("https://x.test/services"));
    check("extractLinks: keeps an absolute same-origin href", links.includes("https://x.test/about"));
    check("extractLinks: keeps an off-site href too (filtering happens later, in filterAndCapUrls)", links.includes("https://other.test/page"));
    check("extractLinks: keeps mailto: too (filtering happens later)", links.some((l) => l.startsWith("mailto:")));
    check("extractLinks: a bare #fragment resolves against baseUrl", links.some((l) => l.includes("#section")));
    check("extractLinks: an <a> with no href contributes nothing extra", links.length === 5);
  }

  // ── filterAndCapUrls ──
  {
    const origin = "https://x.test";
    const urls = [
      "https://x.test/page-1",
      "https://x.test/page-2",
      "https://x.test/page-1", // dup
      "https://x.test/page-1#section", // same page, different fragment -> dedupes with page-1
      "https://other.test/page", // different origin -> dropped
      "https://x.test/brochure.pdf", // non-content -> dropped
      "mailto:hi@x.test", // non-content -> dropped
      "https://x.test/admin/secret", // robots-blocked -> dropped
      "not a url", // malformed -> dropped
    ];
    const filtered = filterAndCapUrls(urls, origin, ["/admin"], 40);
    check(
      "filterAndCapUrls: same-origin + non-content + robots + dedupe all applied",
      JSON.stringify(filtered) === JSON.stringify(["https://x.test/page-1", "https://x.test/page-2"]),
    );

    const manyUrls = Array.from({ length: 60 }, (_, i) => `https://x.test/page-${i}`);
    check("filterAndCapUrls: caps at the given limit", filterAndCapUrls(manyUrls, origin, [], 40).length === 40);
    check("filterAndCapUrls: empty input -> []", filterAndCapUrls([], origin, [], 40).length === 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. discoverUrls / fetchPage against a mocked fetch
  // ════════════════════════════════════════════════════════════════════

  // Sitemap-first discovery, happy path.
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/robots.txt") return notFound();
      if (url === "https://x.test/sitemap.xml") {
        return xmlResponse(
          `<urlset><url><loc>https://x.test/services/massage</loc></url><url><loc>https://x.test/about</loc></url></urlset>`,
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async (calls) => {
      const urls = await discoverUrls("https://x.test");
      check(
        "discoverUrls: sitemap-first happy path returns the sitemap's URLs",
        JSON.stringify(urls) === JSON.stringify(["https://x.test/services/massage", "https://x.test/about"]),
      );
      check("discoverUrls: never fetches the homepage when the sitemap yields URLs", !calls.some((c) => c.url === "https://x.test/" || c.url === "https://x.test"));
      const robotsCall = calls.find((c) => c.url === "https://x.test/robots.txt");
      check("discoverUrls: sends the descriptive User-Agent", (robotsCall?.init?.headers as Record<string, string>)?.["User-Agent"] === USER_AGENT);
    },
  );

  // robots.txt Disallow actually excludes a sitemap URL end-to-end.
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/robots.txt") return new Response("User-agent: *\nDisallow: /admin\n", { status: 200 });
      if (url === "https://x.test/sitemap.xml") {
        return xmlResponse(`<urlset><url><loc>https://x.test/admin/dashboard</loc></url><url><loc>https://x.test/blog</loc></url></urlset>`);
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const urls = await discoverUrls("https://x.test");
      check("discoverUrls: robots Disallow excludes a matching sitemap URL", !urls.includes("https://x.test/admin/dashboard"));
      check("discoverUrls: a non-disallowed sitemap URL survives", urls.includes("https://x.test/blog"));
    },
  );

  // Sitemap INDEX: child sitemaps are fetched and pooled together.
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/robots.txt") return notFound();
      if (url === "https://x.test/sitemap.xml") {
        return xmlResponse(
          `<sitemapindex><sitemap><loc>https://x.test/sitemap-a.xml</loc></sitemap><sitemap><loc>https://x.test/sitemap-b.xml</loc></sitemap></sitemapindex>`,
        );
      }
      if (url === "https://x.test/sitemap-a.xml") return xmlResponse(`<urlset><url><loc>https://x.test/a-page</loc></url></urlset>`);
      if (url === "https://x.test/sitemap-b.xml") return xmlResponse(`<urlset><url><loc>https://x.test/b-page</loc></url></urlset>`);
      throw new Error(`unexpected fetch: ${url}`);
    },
    async (calls) => {
      const urls = await discoverUrls("https://x.test");
      check("discoverUrls: sitemap index -> both children fetched", calls.some((c) => c.url === "https://x.test/sitemap-a.xml") && calls.some((c) => c.url === "https://x.test/sitemap-b.xml"));
      check(
        "discoverUrls: pages from BOTH child sitemaps are pooled together",
        urls.includes("https://x.test/a-page") && urls.includes("https://x.test/b-page"),
      );
    },
  );

  // No usable sitemap -> homepage-links fallback, homepage itself included.
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/robots.txt") return notFound();
      if (url === "https://x.test/sitemap.xml") return notFound();
      if (url === "https://x.test" || url === "https://x.test/") {
        return htmlResponse(`<html><body><a href="/services">Services</a><a href="/contact">Contact</a></body></html>`);
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const urls = await discoverUrls("https://x.test");
      check("discoverUrls: falls back to homepage links when sitemap.xml 404s", urls.includes("https://x.test/services") && urls.includes("https://x.test/contact"));
      check("discoverUrls: includes the homepage itself as a candidate", urls.includes("https://x.test/") || urls.includes("https://x.test"));
    },
  );

  // Empty sitemap urlset (parses fine, zero <loc>s) also falls back to the homepage.
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/robots.txt") return notFound();
      if (url === "https://x.test/sitemap.xml") return xmlResponse(`<urlset></urlset>`);
      if (url === "https://x.test" || url === "https://x.test/") {
        return htmlResponse(`<html><body><a href="/fallback-page">Fallback</a></body></html>`);
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const urls = await discoverUrls("https://x.test");
      check("discoverUrls: an empty sitemap urlset falls back to homepage links", urls.includes("https://x.test/fallback-page"));
    },
  );

  // Homepage itself unreachable too -> [], never throws.
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/robots.txt") return notFound();
      if (url === "https://x.test/sitemap.xml") return notFound();
      if (url === "https://x.test" || url === "https://x.test/") return notFound();
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const urls = await discoverUrls("https://x.test");
      check("discoverUrls: no sitemap AND no reachable homepage -> [] (never throws)", Array.isArray(urls) && urls.length === 0);
    },
  );

  // Cap at 40 even when the sitemap lists far more.
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/robots.txt") return notFound();
      if (url === "https://x.test/sitemap.xml") {
        const locs = Array.from({ length: 100 }, (_, i) => `<url><loc>https://x.test/page-${i}</loc></url>`).join("");
        return xmlResponse(`<urlset>${locs}</urlset>`);
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const urls = await discoverUrls("https://x.test");
      check("discoverUrls: capped at MAX_PAGES_PER_SITE even with 100 sitemap entries", urls.length === MAX_PAGES_PER_SITE);
    },
  );

  // Malformed baseUrl / non-http(s) scheme -> [], zero fetch calls.
  await withMockFetch(
    () => {
      throw new Error("fetch must not be called for a malformed/non-http(s) baseUrl");
    },
    async (calls) => {
      check("discoverUrls: malformed baseUrl -> [] with zero fetch calls", (await discoverUrls("not a url")).length === 0);
      check("discoverUrls: a ftp:// baseUrl -> [] with zero fetch calls", (await discoverUrls("ftp://x.test")).length === 0);
      check("discoverUrls: truly zero network calls for either", calls.length === 0);
    },
  );

  // A throwing/aborting fetch never propagates.
  await withMockFetch(
    () => {
      throw new TypeError("network down");
    },
    async () => {
      await assert.doesNotReject(async () => {
        const urls = await discoverUrls("https://x.test");
        check("discoverUrls: a throwing fetch resolves to [] (never throws)", urls.length === 0);
      });
    },
  );

  // ── fetchPage ──
  await withMockFetch(
    (url) => {
      if (url === "https://x.test/services/massage") return htmlResponse("<html><body><h1>Massage</h1></body></html>");
      throw new Error(`unexpected fetch: ${url}`);
    },
    async (calls) => {
      const result = await fetchPage("https://x.test/services/massage");
      check("fetchPage: happy path returns {url, html}", result?.url === "https://x.test/services/massage" && result?.html.includes("<h1>Massage</h1>"));
      const headers = calls[0]?.init?.headers as Record<string, string>;
      check("fetchPage: sends the descriptive User-Agent", headers?.["User-Agent"] === USER_AGENT);
    },
  );

  await withMockFetch(
    () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    async () => {
      const result = await fetchPage("https://x.test/api/data");
      check("fetchPage: a declared non-text/html content-type -> null", result === null);
    },
  );

  await withMockFetch(
    () => {
      // Node's Response constructor defaults content-type to
      // "text/plain;charset=UTF-8" for a plain string body — deleting the
      // header afterwards is the only way to genuinely simulate a
      // misconfigured server sending NO content-type at all.
      const res = new Response("<html><body>no content-type header</body></html>", { status: 200 });
      res.headers.delete("content-type");
      return res;
    },
    async () => {
      const result = await fetchPage("https://x.test/weird-server");
      check("fetchPage: a MISSING content-type header still passes through", result !== null);
    },
  );

  await withMockFetch(
    () => new Response("not found", { status: 404 }),
    async () => {
      check("fetchPage: HTTP 404 -> null", (await fetchPage("https://x.test/missing")) === null);
    },
  );

  await withMockFetch(
    () => {
      throw new TypeError("network down");
    },
    async () => {
      await assert.doesNotReject(async () => {
        check("fetchPage: a throwing fetch resolves to null (never throws)", (await fetchPage("https://x.test/x")) === null);
      });
    },
  );

  // Byte cap: a response larger than the ~500KB cap is truncated at (not
  // just near) the cap — delivered as a SINGLE oversized chunk (proven by a
  // probe: Node's `Response` can hand a whole body back as one chunk), so
  // this also proves the cap is enforced by slicing the chunk itself, not
  // merely checking `received` after the fact.
  await withMockFetch(
    () => {
      const big = "x".repeat(600_000);
      return htmlResponse(`<html><body>${big}</body></html>`);
    },
    async () => {
      const result = await fetchPage("https://x.test/huge-page");
      check("fetchPage: a response over the byte cap is truncated, not rejected outright", result !== null);
      check("fetchPage: truncated content is capped at exactly ~500KB, not the full 600KB+", (result?.html.length ?? 0) === 500_000);
    },
  );

  console.log(`\ncrawl: ${passed} checks passed.`);
})();
