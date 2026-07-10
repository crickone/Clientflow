// Provision a new tenant via the platform-admin endpoint.
//
//   node scripts/provision-tenant.mjs --slug=acme --name="Acme Clinic" \
//        --admin-email=owner@acme.com --admin-password=secret123
//
// Requires the app to be running locally (default http://localhost:3000) and at
// least one platform-admin user in control.db (the Renova owner qualifies). The
// script mints a short-lived session for that platform admin, calls the
// endpoint, then removes the throwaway session.
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CONTROL_PATH = path.join(process.cwd(), "data", "control.db");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const slug = arg("slug");
const name = arg("name");
const adminEmail = arg("admin-email");
const adminPassword = arg("admin-password");
const adminName = arg("admin-name");

if (!slug || !name) {
  console.error(
    'Usage: node scripts/provision-tenant.mjs --slug=<slug> --name="<name>" [--admin-email=<e> --admin-password=<p> [--admin-name=<n>]]',
  );
  process.exit(1);
}

const control = new Database(CONTROL_PATH);
control.pragma("journal_mode = WAL");

const platformAdmin = control
  .prepare("SELECT id, email FROM users WHERE is_platform_admin = 1 AND is_active = 1 LIMIT 1")
  .get();
if (!platformAdmin) {
  console.error("No platform-admin user found in control.db. Cannot provision.");
  process.exit(1);
}

const token = crypto.randomBytes(32).toString("hex");
control
  .prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
  .run(token, platformAdmin.id, Date.now() + 5 * 60_000);

async function main() {
  const body = { slug, name };
  if (adminEmail) {
    // Password is optional: omit it to attach an existing identity (who already
    // has one) as an admin of the new tenant; supply it to create a new admin.
    body.admin = { email: adminEmail };
    if (adminPassword) body.admin.password = adminPassword;
    if (adminName) body.admin.name = adminName;
  }
  const res = await fetch(`${BASE}/api/internal/tenants`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `clientflow_session=${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Provision failed (${res.status}):`, json.error || json);
    process.exit(1);
  }
  console.log("Provisioned tenant:", JSON.stringify(json.tenant, null, 2));
  if (body.admin) console.log("Admin user:", adminEmail);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      control.prepare("DELETE FROM auth_sessions WHERE id = ?").run(token);
    } catch {
      /* best effort */
    }
  });
