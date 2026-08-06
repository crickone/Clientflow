#!/usr/bin/env node
/**
 * One-time (idempotent) billing bootstrap:
 *  - grants is_platform_admin=1 to the given email
 *  - creates billing_exempt tenant_billing rows for agency-run tenants
 * Usage: node tools/seed-billing.cjs --admin you@example.com [--exempt renova,inspire,clientflow]
 * In prod: run via railway ssh with the app's better-sqlite3 (see Task 13).
 */
const path = require("node:path");
const Database = require(path.join(__dirname, "..", "app", "node_modules", "better-sqlite3"));

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const adminEmail = flag("admin");
const exemptSlugs = (flag("exempt") || "renova,inspire,clientflow").split(",").map((s) => s.trim()).filter(Boolean);
if (!adminEmail) { console.error("Required: --admin <email>"); process.exit(1); }

const dbPath = process.env.CONTROL_DB || path.join(__dirname, "..", "app", "data", "control.db");
const db = new Database(dbPath);
db.pragma("busy_timeout = 15000");

const u = db.prepare("UPDATE users SET is_platform_admin = 1 WHERE email = ?").run(adminEmail.toLowerCase());
console.log(u.changes ? `✓ platform admin: ${adminEmail}` : `⚠ no user found for ${adminEmail}`);

const now = Date.now();
for (const slug of exemptSlugs) {
  const t = db.prepare("SELECT id, name FROM tenants WHERE slug = ?").get(slug);
  if (!t) { console.log(`⚠ tenant not found: ${slug}`); continue; }
  const r = db
    .prepare(
      `INSERT INTO tenant_billing (tenant_id, status, billing_exempt, created_at, updated_at)
       VALUES (?, 'active', 1, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET billing_exempt = 1, status = 'active'`,
    )
    .run(t.id, now, now);
  db.prepare("INSERT INTO billing_events (tenant_id, type, detail, actor, created_at) VALUES (?, 'billing_exempt_created', NULL, 'seed-script', ?)")
    .run(t.id, now);
  console.log(`✓ exempt: ${t.name} (${slug})`, r.changes ? "" : "(already)");
}
db.close();
