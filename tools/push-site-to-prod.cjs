#!/usr/bin/env node
/**
 * Push a bespoke site's HTML from sites/<slug>/ into the PRODUCTION CMS.
 *
 * Why this exists: tools/import-site.cjs writes to a database on this machine,
 * and the local data/ folder is a stale development copy. Production lives on
 * the Railway volume, and the Docker image is rooted at app/ — it carries no
 * sites/ folder and no tools/, so the importer cannot simply be run there.
 *
 * So this script does the reading here and the writing there: it renders every
 * page with the SAME transform the local importer uses (tools/lib/siteHtml.cjs
 * — shared deliberately, so the two can never drift), compresses the result,
 * and hands it to a short program that runs inside the container against the
 * real database.
 *
 * What it changes, and what it leaves alone. It upserts three rows per page:
 * the `pages` row, the page's `body` content block, and its `seo_meta`. It
 * touches nothing else — not media, not blog posts, not domains, not any page
 * of the site that no longer has a file in sites/<slug>/. A page somebody has
 * edited in Studio WILL be overwritten by the file on disk, which is why the
 * script prints who last edited each page and refuses to run if any of them
 * was edited in Studio unless you pass --overwrite-studio-edits.
 *
 * Usage:
 *   node tools/push-site-to-prod.cjs --slug inspire            # dry run: show the diff
 *   node tools/push-site-to-prod.cjs --slug inspire --apply    # actually write
 *
 * Options:
 *   --dir <path>                source folder (default sites/<slug>)
 *   --tenant <slug>             tenant whose database holds the site
 *                               (default: the site slug)
 *   --service <name>            Railway service (default: the linked one)
 *   --overwrite-studio-edits    proceed even if a page was edited in Studio
 */
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const { readSitePages } = require("./lib/siteHtml.cjs");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const slug = arg("slug");
if (!slug) {
  console.error("Required: --slug <site-slug>");
  process.exit(1);
}
const tenant = arg("tenant", slug);
const dir = path.resolve(ROOT, arg("dir", path.join("sites", slug)));
const apply = flag("apply");
const overwriteStudio = flag("overwrite-studio-edits");

if (!fs.existsSync(dir)) {
  console.error(`Source folder not found: ${dir}`);
  process.exit(1);
}

// ── 1. Render the pages here, where the source lives. ────────────────────────
const pages = readSitePages(dir, slug);
if (pages.length === 0) {
  console.error(`No pages found in ${dir}`);
  process.exit(1);
}
const payload = zlib.gzipSync(Buffer.from(JSON.stringify({ slug, tenant, pages }), "utf8"));
const b64 = payload.toString("base64");

console.log(`${pages.length} pages from ${path.relative(ROOT, dir)}/`);
for (const p of pages) console.log(`  ${p.path.padEnd(20)} ${String(p.body.length).padStart(7)} bytes`);
console.log(`payload ${(b64.length / 1024).toFixed(0)} KB base64\n`);

// A command line has a size limit (ARG_MAX, commonly 256 KB). Nine pages of a
// marketing site compress to well under that, but a much larger site would
// not, and a silently truncated payload would corrupt every page it touched.
if (b64.length > 120_000) {
  console.error(
    `Payload is ${(b64.length / 1024).toFixed(0)} KB, too large to pass as one argument.\n` +
      `Split the push (--dir a subfolder) or teach this script to stream.`,
  );
  process.exit(1);
}

// ── 2. The program that runs inside the container. ───────────────────────────
// It resolves the tenant database the same way the app does: cwd/data holds
// control.db, whose `tenants` row carries the db_file for this tenant.
const remote = `
const zlib = require("zlib"), path = require("path"), fs = require("fs");
// The container's app is rooted at /app; a local rehearsal of this same
// program resolves it from wherever node is run instead.
let Database;
try { Database = require("/app/node_modules/better-sqlite3"); }
catch { Database = require(path.join(process.cwd(), "node_modules", "better-sqlite3")); }
const { slug, tenant, pages } = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(process.argv[2], "utf8").trim(), "base64")).toString("utf8"));
const APPLY = process.argv[3] === "apply", FORCE = process.argv[4] === "force";
const DATA = path.join(process.cwd(), "data");
const control = new Database(path.join(DATA, "control.db"), { readonly: true });
const trow = control.prepare("SELECT id, db_file FROM tenants WHERE slug = ?").get(tenant);
if (!trow) { console.error("no such tenant: " + tenant); process.exit(1); }
const dbPath = path.isAbsolute(trow.db_file) ? trow.db_file : path.join(DATA, trow.db_file);
if (!fs.existsSync(dbPath)) { console.error("tenant database missing: " + dbPath); process.exit(1); }
console.log("tenant " + tenant + " (#" + trow.id + ") -> " + dbPath);

const db = new Database(dbPath, { readonly: !APPLY });
const site = db.prepare("SELECT id FROM sites WHERE slug = ?").get(slug);
if (!site) { console.error("no such site in that tenant: " + slug); process.exit(1); }
const SID = site.id;

// Report before writing: what changes, and whether a human had edited it.
let changed = 0, studioEdited = [];
for (const p of pages) {
  const row = db.prepare(
    "SELECT p.id, cb.value, cb.updated_by FROM pages p LEFT JOIN content_blocks cb ON cb.page_id = p.id AND cb.name = 'body' WHERE p.site_id = ? AND p.path = ?"
  ).get(SID, p.path);
  const before = row && row.value ? row.value.length : 0;
  const same = row && row.value === p.body;
  if (!same) changed++;
  if (row && row.updated_by) studioEdited.push(p.path + " (by " + row.updated_by + ")");
  console.log("  " + (same ? "same    " : row ? "CHANGED " : "NEW     ") + p.path.padEnd(20) + before + " -> " + p.body.length);
}
if (studioEdited.length && !FORCE) {
  console.error("");
  console.error("Refusing: these pages were edited in Studio and would be overwritten:");
  for (const s of studioEdited) console.error("  " + s);
  console.error("Re-run with --overwrite-studio-edits if the files on disk are the truth.");
  console.error("(That also hands those pages back to the repo, so later deploys manage them again.)");
  process.exit(2);
}
if (!APPLY) { console.log(""); console.log(changed + " page(s) would change. Dry run - nothing written."); process.exit(0); }
if (changed === 0) { console.log(""); console.log("Nothing to do."); process.exit(0); }

const upPage = db.prepare("INSERT INTO pages (site_id,page_key,path,title,template_id,status,published_at,created_at,updated_at) VALUES (@sid,@key,@path,@title,'clientflow-live','published',@now,@now,@now) ON CONFLICT(site_id,path) DO UPDATE SET title=@title, template_id='clientflow-live', status='published', published_at=@now, updated_at=@now");
const getPage = db.prepare("SELECT id FROM pages WHERE site_id=? AND path=?");
// Overriding hands the page BACK to the repo: updated_by is cleared, so the
// ordinary deploy sync owns it again from here. Without that, a page edited
// once in Studio or through the assistant would be skipped by every future
// deploy forever, and each later change would need this override again — the
// guard would stop being "a human edited this" and become "this page is
// permanently manual".
const upBlock = db.prepare("INSERT INTO content_blocks (site_id,page_id,name,kind,value,updated_by,created_at,updated_at) VALUES (@sid,@pid,'body','html',@val,NULL,@now,@now) ON CONFLICT(site_id,page_id,name) DO UPDATE SET value=@val, kind='html', updated_by=NULL, updated_at=@now");
const upSeo = db.prepare("INSERT INTO seo_meta (site_id,page_id,seo_title,seo_description,robots,created_at,updated_at) VALUES (@sid,@pid,@title,@desc,'index,follow',@now,@now) ON CONFLICT(site_id,page_id) DO UPDATE SET seo_title=@title, seo_description=@desc, updated_at=@now");

// One transaction: a half-written site is worse than an out-of-date one.
db.transaction(() => {
  for (const p of pages) {
    const now = Date.now();
    upPage.run({ sid: SID, key: p.key, path: p.path, title: p.title, now });
    const pid = getPage.get(SID, p.path).id;
    upBlock.run({ sid: SID, pid, val: p.body, now });
    upSeo.run({ sid: SID, pid, title: p.title, desc: p.desc, now });
  }
})();
console.log("");
console.log("wrote " + pages.length + " pages (" + changed + " changed) to site '" + slug + "' (#" + SID + ")");
`;

// ── 3. Hand it to the container. ─────────────────────────────────────────────
//
// Both the program and the payload travel as base64 and are decoded on the far
// side. That is not belt-and-braces: `railway ssh` hands the command to a
// shell, so a program containing quotes, backticks and `$` would be mangled
// somewhere in the middle and fail in a way that is tedious to read. base64 is
// alphanumeric plus `+/=`, so it survives any quoting intact.
const service = arg("service");
const remoteB64 = Buffer.from(remote, "utf8").toString("base64");
const script = [
  `printf %s '${remoteB64}' | base64 -d > /tmp/push-site.cjs`,
  `printf %s '${b64}' > /tmp/push-site-payload.b64`,
  `node /tmp/push-site.cjs /tmp/push-site-payload.b64 ${apply ? "apply" : "dry"} ${overwriteStudio ? "force" : "no"}`,
  `rc=$?`,
  `rm -f /tmp/push-site.cjs /tmp/push-site-payload.b64`,
  `exit $rc`,
].join("; ");

const sshArgs = ["ssh"];
if (service) sshArgs.push("--service", service);
sshArgs.push(`sh -c "${script.replace(/"/g, '\\"')}"`);

console.log(apply ? "Applying to production...\n" : "Dry run against production...\n");
try {
  execFileSync("railway", sshArgs, { cwd: path.join(ROOT, "app"), stdio: "inherit" });
} catch (err) {
  process.exit(typeof err.status === "number" ? err.status : 1);
}
if (!apply) console.log("\nRe-run with --apply to write.");
