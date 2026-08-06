#!/usr/bin/env node
/**
 * Apply the shipped clientflow-site.json dump to the clientflow tenant DB on
 * this container (idempotent upserts by natural keys). Run on the server:
 *   node /app/.site-import/apply.cjs
 * The dump is produced locally by the marketing-site import (see repo
 * tools/import-site.cjs) and shipped inside the image so the volume-hosted
 * tenant DB can be seeded without pushing 400KB through `railway ssh` args.
 */
const path = require("node:path");
const fs = require("node:fs");
const Database = require(fs.existsSync("/app/node_modules/better-sqlite3")
  ? "/app/node_modules/better-sqlite3"
  : "better-sqlite3");

const DUMP = path.join(__dirname, "clientflow-site.json");
const DB = process.env.TENANT_DB || "/app/data/tenants/clientflow/clientflow.db";
const d = JSON.parse(fs.readFileSync(DUMP, "utf8"));
const db = new Database(DB);
db.pragma("busy_timeout = 15000");

// Site (by slug)
let site = db.prepare("SELECT id FROM sites WHERE slug=?").get(d.site.slug);
if (!site) {
  const r = db
    .prepare("INSERT INTO sites (slug,name,status,primary_host,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(d.site.slug, d.site.name, d.site.status, d.site.primary_host, Date.now(), Date.now());
  site = { id: Number(r.lastInsertRowid) };
  console.log("created site #" + site.id);
} else {
  db.prepare("UPDATE sites SET name=?, status=?, primary_host=? WHERE id=?")
    .run(d.site.name, d.site.status, d.site.primary_host, site.id);
  console.log("updated site #" + site.id);
}
const SID = site.id;
const now = Date.now();

// Pages by (site_id, path); remap ids for blocks/seo.
const idMap = new Map();
const upPage = db.prepare(
  `INSERT INTO pages (site_id,page_key,path,title,template_id,status,published_at,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)
   ON CONFLICT(site_id,path) DO UPDATE SET title=excluded.title, template_id=excluded.template_id, status=excluded.status, published_at=excluded.published_at, updated_at=excluded.updated_at`,
);
for (const p of d.pages) {
  upPage.run(SID, p.page_key, p.path, p.title, p.template_id, p.status, p.published_at, now, now);
  const row = db.prepare("SELECT id FROM pages WHERE site_id=? AND path=?").get(SID, p.path);
  idMap.set(p.id, row.id);
}
console.log("pages upserted:", d.pages.length);

// Blocks by (site_id, page_id, name)
const delBlock = db.prepare("DELETE FROM content_blocks WHERE site_id=? AND page_id=? AND name=?");
const insBlock = db.prepare(
  "INSERT INTO content_blocks (site_id,page_id,name,kind,value,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
);
for (const b of d.blocks) {
  const pid = idMap.get(b.page_id);
  if (!pid) continue;
  delBlock.run(SID, pid, b.name);
  insBlock.run(SID, pid, b.name, b.kind, b.value, now, now);
}
console.log("blocks applied:", d.blocks.length);

// SEO by (site_id, page_id)
const delSeo = db.prepare("DELETE FROM seo_meta WHERE site_id=? AND page_id=?");
const insSeo = db.prepare(
  "INSERT INTO seo_meta (site_id,page_id,seo_title,seo_description,robots,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
);
for (const s of d.seo) {
  const pid = idMap.get(s.page_id);
  if (!pid) continue;
  delSeo.run(SID, pid);
  insSeo.run(SID, pid, s.seo_title, s.seo_description, s.robots, now, now);
}
console.log("seo applied:", d.seo.length);

// Blog posts by (site_id, slug)
const insPost = db.prepare(
  `INSERT INTO blog_posts (title,input_mode,content,status,site_id,slug,excerpt,seo_title,seo_description,publish_state,published_at,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
let np = 0;
for (const p of d.posts) {
  const dup = db.prepare("SELECT id FROM blog_posts WHERE site_id=? AND slug=?").get(SID, p.slug);
  if (dup) continue;
  insPost.run(p.title, p.input_mode, p.content, p.status, SID, p.slug, p.excerpt, p.seo_title, p.seo_description, p.publish_state, p.published_at, now, now);
  np++;
}
console.log("posts inserted:", np, "(existing skipped:", d.posts.length - np + ")");
console.log("DONE site #" + SID);
db.close();
