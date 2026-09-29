// Run: npm test -- src/lib/cms/bundledSites.test.ts
//
// A site bundle that ships in the build but is not in BUNDLED_SITES is never
// applied: the deploy succeeds and the site silently stays on whatever the
// last import left behind. Healthwise's first end-to-end run hit exactly
// that. This reads the source and the shipped bundles and refuses the pair
// to drift. Same idea for the public route list in middleware.ts: a public
// form whose route is not listed 307s every visitor to /login, while the
// route's own tests (which call the handler directly) stay green.
// To stop syncing a shipped site later, delete its bundle files from public/sites/<slug>/ rather than removing the slug here; the module's opt-in policy protects Studio-authored sites, and this test only insists that what ships is applied.
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
const stripComments = (s: string) => s.replace(/\/\/.*$/gm, "");
const listSrc = stripComments(/const BUNDLED_SITES[^=]*=\s*\[([\s\S]*?)\];/.exec(sync)?.[1] ?? "");
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
const prefixesSrc = stripComments(/const PUBLIC_API_PREFIXES\s*=\s*\[([\s\S]*?)\];/.exec(middleware)?.[1] ?? "");
const prefixes = [...prefixesSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check("PUBLIC_API_PREFIXES parsed from source", prefixes.length > 0);
for (const p of ["/api/site/enquiry", "/api/campaigns/signup", "/api/leads/inbound"]) {
  check(`public form route ${p} is reachable without a session`, prefixes.includes(p));
}

// A bundle carries its pages' HTML, but NOT the images that HTML points at:
// those are files under public/sites/<slug>/assets/, copied there by the
// importer. Add a photograph to a site's source folder, rebuild the bundle
// and deploy, and the page ships referencing a file that was never copied —
// the deploy is green, every check passes, and the visitor sees a broken
// image. Studio 60 shipped exactly that. So: every asset any shipped bundle
// references must exist on disk.
for (const slug of shipped) {
  const bundleFile = path.join(sitesDir, slug, "_pages.json");
  if (!fs.existsSync(bundleFile)) continue;
  const bundle = JSON.parse(fs.readFileSync(bundleFile, "utf8")) as { pages?: Array<{ path: string; body: string }> };
  const missing = new Set<string>();
  for (const page of bundle.pages ?? []) {
    // src="/sites/<slug>/assets/x.jpg", and the same inside url(...) in styles.
    for (const m of page.body.matchAll(/\/sites\/[a-z0-9-]+\/[^"')\s]+\.(?:jpg|jpeg|png|webp|svg|avif)/gi)) {
      const rel = m[0].replace(/^\/sites\//, "");
      if (!fs.existsSync(path.join(sitesDir, rel))) missing.add(m[0]);
    }
  }
  check(`bundle "${slug}" references no missing asset${missing.size ? ` (${[...missing].join(", ")})` : ""}`, missing.size === 0);
}

console.log(`bundledSites.test.ts: ${passed} checks passed`);
