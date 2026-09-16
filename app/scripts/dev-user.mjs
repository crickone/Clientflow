/**
 * Create a LOCAL-ONLY staff login, so the app can be driven in a browser on a
 * dev machine (responsive checks, screenshots, e2e).
 *
 * Run:  node scripts/dev-user.mjs
 *       node scripts/dev-user.mjs --email dev@local.test --password something
 *
 * WHY THIS IS A SCRIPT AND NOT A FEATURE. The obvious way to get a test login
 * is a dev-only bypass in the auth code — an env var that skips the password,
 * a magic account the login route recognises. Every one of those is a new
 * branch in the thing that decides who may read four businesses' client data,
 * and it ships in the production bundle whether or not it can fire there. A
 * script that writes a row into a local SQLite file is not part of the app at
 * all: production has no code path to reach, because there is no code path.
 *
 * WHAT STOPS IT TOUCHING PRODUCTION. Three things, checked before any write:
 *
 *   1. NODE_ENV must not be "production".
 *   2. The database must be the repo's own app/data/control.db, resolved from
 *      this file's location — not from an env var or an argument, so there is
 *      nothing to point somewhere else.
 *   3. That path must not be the Railway volume (/app/data), which is where
 *      production's databases actually live.
 *
 * Production's data is on a Railway volume reachable only over `railway ssh`,
 * and this refuses to run there even if it were somehow copied up.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const DB_PATH = path.join(APP, "data", "control.db");

function refuse(why) {
  console.error(`\nRefusing to run: ${why}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  refuse("NODE_ENV is production. This creates a login and is for dev machines only.");
}
// The Railway volume. Belt and braces: DB_PATH is derived from this file's
// own location, so it cannot be pointed here — this catches the case where
// the repo itself has been copied onto the volume.
if (DB_PATH.startsWith("/app/data")) {
  refuse("that is the production volume (/app/data).");
}
if (!fs.existsSync(DB_PATH)) {
  refuse(`no local control DB at ${DB_PATH}. Run the app once to create it.`);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const email = arg("email", "dev@local.test");
const password = arg("password", "dev-local-only");
const name = arg("name", "Dev Local");

/** The same format lib/password.ts writes, so the ordinary login verifies it. */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const Database = require(path.join(APP, "node_modules", "better-sqlite3"));
const db = new Database(DB_PATH);

const tenants = db.prepare("select id, slug, name from tenants where is_active = 1 order by id").all();
if (tenants.length === 0) refuse("this local control DB has no active tenants.");

const wantedSlug = arg("tenant", null);
const tenant = wantedSlug ? tenants.find((t) => t.slug === wantedSlug) : tenants[0];
if (!tenant) {
  refuse(`no tenant "${wantedSlug}". Have: ${tenants.map((t) => t.slug).join(", ")}`);
}

const now = Date.now();
const hash = hashPassword(password);
const existing = db.prepare("select id from users where email = ?").get(email);

let userId;
if (existing) {
  db.prepare(
    `update users set password_hash = ?, role = 'admin', is_active = 1,
       must_change_password = 0, tenant_id = ?, updated_at = ? where id = ?`,
  ).run(hash, tenant.id, now, existing.id);
  userId = existing.id;
  console.log(`Updated existing local user ${email}`);
} else {
  const info = db
    .prepare(
      `insert into users (email, name, password_hash, role, tenant_id,
         is_platform_admin, must_change_password, is_active, created_at, updated_at)
       values (?, ?, ?, 'admin', ?, 0, 0, 1, ?, ?)`,
    )
    .run(email, name, hash, tenant.id, now, now);
  userId = info.lastInsertRowid;
  console.log(`Created local user ${email}`);
}

// A membership per tenant, so the account switcher has something to switch
// between — tenant-scoped layout is exactly the kind of thing worth checking
// in a browser.
const addMembership = db.prepare(
  `insert into memberships (user_id, tenant_id, role, is_active, created_at)
   values (?, ?, 'admin', 1, ?)`,
);
const hasMembership = db.prepare(
  "select id from memberships where user_id = ? and tenant_id = ?",
);
for (const t of tenants) {
  if (!hasMembership.get(userId, t.id)) addMembership.run(userId, t.id, now);
}

console.log(`
  Local login ready (this database only — ${path.relative(process.cwd(), DB_PATH)})

    email     ${email}
    password  ${password}
    tenants   ${tenants.map((t) => t.slug).join(", ")}

  Start the app with:  npm run dev
`);
