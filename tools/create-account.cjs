#!/usr/bin/env node
/**
 * Provision a new ClientFlow sub-account (tenant) in the control plane.
 *
 * Mirrors src/lib/tenants.ts#createTenant but operates on the SQLite control DB
 * directly (same approach as import-site.cjs), so it can run outside the app:
 *   - registers the tenant in control.db (slug, name, db_file),
 *   - creates the tenant DB directory + file (the app's openTenantDb builds the
 *     full per-tenant schema lazily on first access),
 *   - grants an EXISTING identity (by email) an active admin membership.
 *
 * Optionally links a CMS site (in the agency tenant DB) to this account.
 *
 * Usage:
 *   node tools/create-account.cjs --slug inspire --name "Inspire Health & Fitness" \
 *        --admin christopher.walshe1994@gmail.com --link-site inspire
 *
 * Defaults: --control app/data/control.db, --site-db app/data/clinic.db
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

const slug = (arg("slug") || "").trim().toLowerCase();
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error("Required: --slug <lowercase-letters-digits-hyphens>");
  process.exit(1);
}
const name = arg("name", slug);
const adminEmail = (arg("admin") || "").trim().toLowerCase();
const linkSite = (arg("link-site") || "").trim().toLowerCase();
const controlPath = path.resolve(ROOT, arg("control", "app/data/control.db"));
const siteDbPath = path.resolve(ROOT, arg("site-db", "app/data/clinic.db"));

const control = new Database(controlPath);
const now = Date.now();

// 1) Register the tenant (idempotent on slug).
let tenant = control.prepare("SELECT * FROM tenants WHERE slug=?").get(slug);
if (tenant) {
  console.log(`tenant '${slug}' already exists (#${tenant.id})`);
} else {
  const dbFile = `tenants/${slug}/${slug}.db`;
  const info = control
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active, created_at) VALUES (?,?,?,1,?)",
    )
    .run(slug, name, dbFile, now);
  tenant = { id: Number(info.lastInsertRowid), slug, db_file: dbFile };
  // Ensure the tenant DB directory exists; the app seeds the schema on first open.
  fs.mkdirSync(path.dirname(path.join(APP, "data", dbFile)), { recursive: true });
  console.log(`created tenant '${slug}' (#${tenant.id})  db_file=${dbFile}`);
}

// 2) Grant the admin membership (reuse existing identity only).
if (adminEmail) {
  const user = control
    .prepare("SELECT id FROM users WHERE email=?")
    .get(adminEmail);
  if (!user) {
    console.error(
      `admin '${adminEmail}' not found — create the identity in the app first.`,
    );
  } else {
    const existing = control
      .prepare("SELECT id FROM memberships WHERE user_id=? AND tenant_id=?")
      .get(user.id, tenant.id);
    if (existing) {
      control
        .prepare("UPDATE memberships SET role='admin', is_active=1 WHERE id=?")
        .run(existing.id);
      console.log(`membership refreshed: ${adminEmail} → ${slug} (admin)`);
    } else {
      control
        .prepare(
          "INSERT INTO memberships (user_id, tenant_id, role, is_active, created_at) VALUES (?,?,'admin',1,?)",
        )
        .run(user.id, tenant.id, now);
      console.log(`membership granted: ${adminEmail} → ${slug} (admin)`);
    }
  }
}

// 3) Optionally link a CMS site (in the agency tenant DB) to this account.
if (linkSite) {
  const siteDb = new Database(siteDbPath);
  const site = siteDb.prepare("SELECT id FROM sites WHERE slug=?").get(linkSite);
  if (!site) {
    console.error(`site '${linkSite}' not found in ${siteDbPath}`);
  } else {
    siteDb
      .prepare("UPDATE sites SET linked_tenant_slug=?, updated_at=? WHERE id=?")
      .run(slug, now, site.id);
    console.log(`linked CMS site '${linkSite}' → account '${slug}'`);
  }
  siteDb.close();
}

control.close();
console.log("done.");
