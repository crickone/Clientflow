// Run: npm test -- src/lib/cms/bundledSites.test.ts
//
// A site bundle that ships in the build but is not in BUNDLED_SITES is never
// applied: the deploy succeeds and the site silently stays on whatever the
// last import left behind. Healthwise's first end-to-end run hit exactly
// that. This reads the source and the shipped bundles and refuses the pair
// to drift. Same idea for the public route list in middleware.ts: a public
// form whose route is not listed 307s every visitor to /login, while the
// route's own tests (which call the handler directly) stay green.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const root = process.cwd(); // app/
const sync = fs.readFileSync(path.join(root, "src/lib/cms/syncBundledSite.ts"), "utf8");
const listSrc = /const BUNDLED_SITES[^=]*=\s*\[([\s\S]*?)\];/.exec(sync)?.[1] ?? "";
const bundled = [...listSrc.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
check("BUNDLED_SITES parsed from source", bundled.length > 0);

const sitesDir = path.join(root, "public/sites");
const shipped = fs
  .readdirSync(sitesDir)
  .filter((slug) => fs.existsSync(path.join(sitesDir, slug, "_pages.json")) || fs.existsSync(path.join(sitesDir, slug, "_posts.json")));
check("at least one bundle ships", shipped.length > 0);
for (const slug of shipped) {
  check(`shipped bundle "${slug}" is in BUNDLED_SITES`, bundled.includes(slug));
}

const middleware = fs.readFileSync(path.join(root, "src/middleware.ts"), "utf8");
const prefixesSrc = /const PUBLIC_API_PREFIXES\s*=\s*\[([\s\S]*?)\];/.exec(middleware)?.[1] ?? "";
const prefixes = [...prefixesSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check("PUBLIC_API_PREFIXES parsed from source", prefixes.length > 0);
for (const p of ["/api/site/enquiry", "/api/campaigns/signup", "/api/leads/inbound"]) {
  check(`public form route ${p} is reachable without a session`, prefixes.includes(p));
}

console.log(`bundledSites.test.ts: ${passed} checks passed`);
