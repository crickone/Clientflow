#!/usr/bin/env node
/**
 * Generalized site importer for ClientFlow CMS.
 *
 * Imports a folder of static HTML pages into the CMS as a Site: creates the site
 * if needed, copies its assets into the app's public dir (namespaced per site),
 * rewrites asset + internal-link URLs, keeps page scripts (animations), and maps
 * <title>/<meta description> into SEO. Pages are published on the "renova-live"
 * template (verbatim first-party HTML with its own styles/scripts).
 *
 * Usage:
 *   node tools/import-site.cjs --slug acme --name "Acme Wellness" [--dir sites/acme]
 *
 * Defaults: --dir sites/<slug>, --db app/data/clinic.db, --template renova-live
 */
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app");
const Database = require(path.join(APP, "node_modules", "better-sqlite3"));

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
const template = arg("template", "renova-live");

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

// 3) Helpers.
const EXCLUDE = /(_Ad_Library_|mockup-)/i;
const m1 = (re, s) => (s.match(re) || [])[1] || null;
const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const rewrite = (html) =>
  html
    // asset folders → namespaced public path
    .replace(/(["'(])(assets|logo|fonts)\//g, `$1/sites/${slug}/$2/`)
    // internal *.html links → CMS site paths
    .replace(/href="([a-z0-9-]+)\.html(#[^"]*)?"/gi, (full, n, frag) => {
      const f = frag || "";
      return n === "index"
        ? `href="/site/${slug}${f}"`
        : `href="/site/${slug}/${n}${f}"`;
    });

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
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".html") && !EXCLUDE.test(f));
let n = 0;
for (const file of files) {
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  const base = file.replace(/\.html$/, "");
  const pagePath = base === "index" ? "/" : `/${base}`;
  const title = decode((m1(/<title>([\s\S]*?)<\/title>/i, raw) || base).trim());
  const desc = decode(
    (m1(/<meta\s+name="description"\s+content="([\s\S]*?)"/i, raw) || "").trim(),
  );
  const styles = (raw.match(/<style[\s\S]*?<\/style>/gi) || []).join("\n");
  const gfonts = (raw.match(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/gi) || []).join("\n");
  const body = m1(/<body[^>]*>([\s\S]*?)<\/body>/i, raw) || "";
  const combined = rewrite(`${gfonts}\n${styles}\n${body}`);

  const now = Date.now();
  upPage.run({ sid: SID, key: base, path: pagePath, title, tpl: template, now });
  const pid = getPage.get(SID, pagePath).id;
  upBlock.run({ sid: SID, pid, val: combined, now });
  upSeo.run({ sid: SID, pid, title, desc, now });
  n++;
}
console.log(`imported ${n} pages into site '${slug}' (#${SID})`);
console.log(`assets → app/public/sites/${slug}/  ·  serve paths /sites/${slug}/...`);
