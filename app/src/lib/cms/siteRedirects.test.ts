// Run: npm test -- src/lib/cms/siteRedirects.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearRedirectCache, matchRedirect, resolveSiteRedirect } from "./siteRedirects";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "site-redirects-"));
try {
  const map = {
    "/post/:slug": "/blog/:slug",
    "/about-healthwise": "/about",
    "/inspire-health-fitness": "https://inspirehealthandfitness.ie",
  };
  fs.mkdirSync(path.join(base, "hw"), { recursive: true });
  fs.writeFileSync(path.join(base, "hw", "_redirects.json"), JSON.stringify(map));
  fs.mkdirSync(path.join(base, "broken"), { recursive: true });
  fs.writeFileSync(path.join(base, "broken", "_redirects.json"), "{ not json");

  check("exact match", resolveSiteRedirect("hw", "/about-healthwise", base)?.target === "/about");
  check("exact match kind internal", resolveSiteRedirect("hw", "/about-healthwise", base)?.kind === "internal");
  check("trailing slash ignored", resolveSiteRedirect("hw", "/about-healthwise/", base)?.target === "/about");
  check(":slug substituted", resolveSiteRedirect("hw", "/post/walking-after-60", base)?.target === "/blog/walking-after-60");
  check(":slug with encoded chars kept", resolveSiteRedirect("hw", "/post/caf%C3%A9-tips", base)?.target === "/blog/caf%C3%A9-tips");
  check("pattern needs the same depth", resolveSiteRedirect("hw", "/post/a/b", base) === null);
  check("pattern needs a value", resolveSiteRedirect("hw", "/post/", base) === null);
  check("external kind", resolveSiteRedirect("hw", "/inspire-health-fitness", base)?.kind === "external");
  check("external target verbatim", resolveSiteRedirect("hw", "/inspire-health-fitness", base)?.target === "https://inspirehealthandfitness.ie");
  check("no match -> null", resolveSiteRedirect("hw", "/nothing-here", base) === null);
  check("root never matches", resolveSiteRedirect("hw", "/", base) === null);
  check("missing file -> null", resolveSiteRedirect("nope", "/about-healthwise", base) === null);
  check("invalid json -> null, no throw", resolveSiteRedirect("broken", "/about-healthwise", base) === null);

  // the map is cached; a rewrite is invisible until the cache is cleared
  fs.writeFileSync(path.join(base, "hw", "_redirects.json"), JSON.stringify({ "/x": "/y" }));
  check("cached map still serves", resolveSiteRedirect("hw", "/about-healthwise", base)?.target === "/about");
  clearRedirectCache();
  check("after clear, new map", resolveSiteRedirect("hw", "/x", base)?.target === "/y");

  // pure matcher: non-string values are ignored
  check("matchRedirect ignores non-string targets", matchRedirect({ "/a": 1 as unknown as string, "/b": "/c" }, "/a") === null);
  check("exact key wins over a pattern that also matches",
    matchRedirect({ "/post/:slug": "/blog/:slug", "/post/latest": "/blog" }, "/post/latest")?.target === "/blog");

  console.log(`siteRedirects.test.ts: ${passed} checks passed`);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
