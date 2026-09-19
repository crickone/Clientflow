#!/usr/bin/env node
/**
 * Generalized site importer for ClientFlow CMS.
 *
 * Imports a folder of static HTML pages into the CMS as a Site: creates the site
 * if needed, copies its assets into the app's public dir (namespaced per site),
 * rewrites asset + internal-link URLs, keeps page scripts (animations), and maps
 * <title>/<meta description> into SEO. Pages are published on the "clientflow-live"
 * template (verbatim first-party HTML with its own styles/scripts).
 *
 * Usage:
 *   node tools/import-site.cjs --slug acme --name "Acme Wellness" [--dir sites/acme]
 *
 * Defaults: --dir sites/<slug>, --db app/data/clinic.db, --template clientflow-live
 */
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app");
const Database = require(path.join(APP, "node_modules", "better-sqlite3"));
// The HTML -> CMS page transform is shared with tools/push-site-to-prod.cjs
// so a page imported locally and a page pushed to production are identical.
const { readSitePages } = require("./lib/siteHtml.cjs");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const slug = arg("slug");
if (!slug) {
  console.error("Required: --slug <site-slug>  (and --name on first import)");
  process.exit(1);
}
const name = arg("name", slug);
const dir = path.resolve(ROOT, arg("dir", path.join("sites", slug)));
const dbPath = path.resolve(ROOT, arg("db", path.join("app", "data", "clinic.db")));
const template = arg("template", "clientflow-live");

if (!fs.existsSync(dir)) {
  console.error(`Source dir not found: ${dir}`);
  process.exit(1);
}

const db = new Database(dbPath);

// 1) Ensure the site exists.
let site = db.prepare("SELECT id, slug FROM sites WHERE slug=?").get(slug);
if (!site) {
  const info = db
    .prepare("INSERT INTO sites (slug, name, status) VALUES (?, ?, 'live')")
    .run(slug, name);
  site = { id: Number(info.lastInsertRowid), slug };
  console.log(`created site '${slug}' (#${site.id})`);
}
const SID = site.id;

// 2) Copy this site's assets into app/public/sites/<slug>/ (namespaced).
const publicBase = path.join(APP, "public", "sites", slug);
for (const folder of ["assets", "logo", "fonts"]) {
  const src = path.join(dir, folder);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(publicBase, folder), { recursive: true });
  }
}

const upPage = db.prepare(
  `INSERT INTO pages (site_id,page_key,path,title,template_id,status,published_at,created_at,updated_at)
   VALUES (@sid,@key,@path,@title,@tpl,'published',@now,@now,@now)
   ON CONFLICT(site_id,path) DO UPDATE SET title=@title, template_id=@tpl, status='published', published_at=@now, updated_at=@now`,
);
const getPage = db.prepare("SELECT id FROM pages WHERE site_id=? AND path=?");
const upBlock = db.prepare(
  `INSERT INTO content_blocks (site_id,page_id,name,kind,value,created_at,updated_at)
   VALUES (@sid,@pid,'body','html',@val,@now,@now)
   ON CONFLICT(site_id,page_id,name) DO UPDATE SET value=@val, kind='html', updated_at=@now`,
);
const upSeo = db.prepare(
  `INSERT INTO seo_meta (site_id,page_id,seo_title,seo_description,robots,created_at,updated_at)
   VALUES (@sid,@pid,@title,@desc,'index,follow',@now,@now)
   ON CONFLICT(site_id,page_id) DO UPDATE SET seo_title=@title, seo_description=@desc, updated_at=@now`,
);

// 4) Import pages.
const pages = readSitePages(dir, slug);
for (const pg of pages) {
  const now = Date.now();
  upPage.run({ sid: SID, key: pg.key, path: pg.path, title: pg.title, tpl: template, now });
  const pid = getPage.get(SID, pg.path).id;
  upBlock.run({ sid: SID, pid, val: pg.body, now });
  upSeo.run({ sid: SID, pid, title: pg.title, desc: pg.desc, now });
}
const n = pages.length;
console.log(`imported ${n} pages into site '${slug}' (#${SID})`);
console.log(`assets → app/public/sites/${slug}/  ·  serve paths /sites/${slug}/...`);
