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
 * WHICH DATABASE: you must say, with --tenant. This used to default to the
 * legacy tenant's clinic.db, and that default is how the Inspire site ended up
 * imported into the Renova tenant, shadowing the client's own copy for months:
 * a site slug is the public URL and the renderer serves the first tenant that
 * has it, so the visible copy and the copy everyone was editing were different
 * rows in different files. There is no safe default for "whose website is
 * this", so there isn't one any more.
 *
 * Usage:
 *   node tools/import-site.cjs --tenant inspire --slug inspire --name "Inspire"
 *   node tools/import-site.cjs --tenant acme --slug acme --name "Acme Wellness" [--dir sites/acme]
 *
 * Defaults: --dir sites/<slug>, --template clientflow-live. --tenant is required
 * (or --db to point at a database file directly, for a throwaway or a test).
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
const template = arg("template", "clientflow-live");

// ── Which tenant's database? ────────────────────────────────────────────────
const DATA = path.join(APP, "data");
const explicitDb = arg("db");
const tenantSlug = arg("tenant");

function resolveTenantDb(wantedTenant) {
  const controlPath = path.join(DATA, "control.db");
  if (!fs.existsSync(controlPath)) {
    console.error(`No control database at ${controlPath} — pass --db to point at a file directly.`);
    process.exit(1);
  }
  const control = new Database(controlPath, { readonly: true });
  const rows = control.prepare("SELECT id, slug, name, db_file FROM tenants ORDER BY id").all();
  const tenant = rows.find((t) => t.slug === wantedTenant);
  if (!tenant) {
    console.error(`No tenant with slug "${wantedTenant}". Known tenants:`);
    for (const t of rows) console.error(`  ${t.slug}  (#${t.id}, ${t.name})`);
    process.exit(1);
  }
  control.close();
  return {
    tenant,
    file: path.isAbsolute(tenant.db_file) ? tenant.db_file : path.join(DATA, tenant.db_file),
  };
}

let dbPath;
let tenantLabel;
if (explicitDb) {
  dbPath = path.resolve(ROOT, explicitDb);
  tenantLabel = `database file ${path.relative(ROOT, dbPath)}`;
} else if (tenantSlug) {
  const resolved = resolveTenantDb(tenantSlug);
  dbPath = resolved.file;
  tenantLabel = `${resolved.tenant.name} (${resolved.tenant.slug}#${resolved.tenant.id})`;
} else {
  console.error("Required: --tenant <tenant-slug>  (whose website is this?)");
  console.error("There is no default. Importing into the wrong tenant creates a second site with");
  console.error("the same slug, and the public URL then serves whichever tenant comes first —");
  console.error("so the copy you edit and the copy visitors see stop being the same one.");
  console.error("Pass --db <file> instead only for a throwaway or a test database.");
  process.exit(1);
}

if (!fs.existsSync(dir)) {
  console.error(`Source dir not found: ${dir}`);
  process.exit(1);
}

const db = new Database(dbPath);

/**
 * Does any OTHER tenant already own this slug?
 *
 * A slug is the public URL, and `resolveHost` serves the first active tenant
 * that has it — so a duplicate does not coexist, it hides one of the two
 * sites. Creating one is the mistake that has to be caught here, because
 * afterwards it looks like nothing is wrong: both copies open fine in the
 * CMS, and only visitors can tell the difference.
 */
function otherTenantsWithSlug(wantedSlug, ownDbFile) {
  const controlPath = path.join(DATA, "control.db");
  if (!fs.existsSync(controlPath)) return [];
  const control = new Database(controlPath, { readonly: true });
  const rows = control.prepare("SELECT id, slug, name, db_file, is_active FROM tenants ORDER BY id").all();
  control.close();
  const found = [];
  for (const t of rows) {
    if (t.is_active === 0) continue;
    const file = path.isAbsolute(t.db_file) ? t.db_file : path.join(DATA, t.db_file);
    if (file === ownDbFile || !fs.existsSync(file)) continue;
    try {
      const other = new Database(file, { readonly: true });
      const hit = other.prepare("SELECT id FROM sites WHERE slug = ?").get(wantedSlug);
      other.close();
      if (hit) found.push({ ...t, siteId: hit.id });
    } catch {
      // An unreadable neighbour is not this import's problem.
    }
  }
  return found;
}

// 1) Ensure the site exists.
let site = db.prepare("SELECT id, slug FROM sites WHERE slug=?").get(slug);
if (!site) {
  const clash = otherTenantsWithSlug(slug, dbPath);
  if (clash.length > 0 && !process.argv.includes("--allow-duplicate-slug")) {
    console.error(`Refusing: the slug "${slug}" already belongs to another business:`);
    for (const c of clash) console.error(`  ${c.name} (${c.slug}#${c.id}), site #${c.siteId}`);
    console.error("");
    console.error("A site slug is the public web address (/site/<slug>/...), and the renderer serves");
    console.error("whichever tenant comes first. Importing here would hide one of the two sites, and");
    console.error("nothing would look broken until somebody pointed a domain at it.");
    console.error("");
    console.error(`Import into ${clash[0].slug} instead, or pick a different --slug.`);
    console.error("--allow-duplicate-slug overrides this, if you genuinely mean to.");
    process.exit(1);
  }
  const info = db
    .prepare("INSERT INTO sites (slug, name, status) VALUES (?, ?, 'live')")
    .run(slug, name);
  site = { id: Number(info.lastInsertRowid), slug };
  console.log(`created site '${slug}' (#${site.id}) in ${tenantLabel}`);
} else {
  console.log(`updating existing site '${slug}' (#${site.id}) in ${tenantLabel}`);
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
