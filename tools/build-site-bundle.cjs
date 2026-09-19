#!/usr/bin/env node
/**
 * Bundle a bespoke site's pages into the app build, so that deploying the app
 * publishes the site.
 *
 * The problem this solves: `sites/<slug>/*.html` is the source of a client's
 * website, but the pages visitors see come from `content_blocks` in the tenant
 * database on the Railway volume. `railway up` ships the app and the site's
 * images and leaves the pages exactly as they were, so a content change could
 * be written, reviewed, merged and deployed while the live site kept serving
 * the old copy. tools/push-site-to-prod.cjs closes that gap over `railway ssh`;
 * this closes it over an ordinary deploy, which is the path most people take.
 *
 * It writes `app/public/sites/<slug>/_pages.json`. `public/` is the one part of
 * the repo copied into the runtime image (see app/Dockerfile), so the bundle
 * travels with the build, and src/lib/cms/syncBundledSite.ts applies it on boot.
 *
 * The bundle carries a content hash rather than a hand-maintained version
 * number, so nobody has to remember to bump anything: the hash changes exactly
 * when the pages change, and the sync applies a bundle whose hash differs from
 * the one already applied.
 *
 * Usage:
 *   node tools/build-site-bundle.cjs --slug inspire
 *   node tools/build-site-bundle.cjs --slug inspire --tenant inspire
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const { readSitePages } = require("./lib/siteHtml.cjs");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : def;
};

const slug = arg("slug");
if (!slug) {
  console.error("Required: --slug <site-slug>");
  process.exit(1);
}
const tenant = arg("tenant", slug);
const dir = path.resolve(ROOT, arg("dir", path.join("sites", slug)));
if (!fs.existsSync(dir)) {
  console.error(`Source folder not found: ${dir}`);
  process.exit(1);
}

const pages = readSitePages(dir, slug);
if (pages.length === 0) {
  console.error(`No pages found in ${dir}`);
  process.exit(1);
}

// Hash the pages only. Re-running with no content change must produce the same
// hash, so the sync stays a no-op and a redeploy does not rewrite the database.
const rev = crypto.createHash("sha256").update(JSON.stringify(pages)).digest("hex").slice(0, 16);

const outDir = path.join(ROOT, "app", "public", "sites", slug);
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "_pages.json");

const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")).rev : null;
fs.writeFileSync(out, JSON.stringify({ slug, tenant, rev, pages }));

console.log(`${pages.length} pages -> ${path.relative(ROOT, out)}`);
console.log(`rev ${rev}${previous ? (previous === rev ? " (unchanged)" : ` (was ${previous})`) : " (new)"}`);
for (const p of pages) console.log(`  ${p.path.padEnd(20)} ${String(p.body.length).padStart(7)} bytes`);
