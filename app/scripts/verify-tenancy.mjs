// Dev-only tenant-isolation proof. Provisions a throwaway 2nd tenant, seeds a
// uniquely-named client into EACH tenant DB, then loads /clients with each
// tenant's session and asserts neither tenant can see the other's data.
// Cleans everything up afterwards. Requires the dev server running on :3000.
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const DATA = path.join(process.cwd(), "data");
const CONTROL = path.join(DATA, "control.db");
const RENOVA_TOKEN = "RenovaOnly_ZETA_marker";
const ACME_TOKEN = "AcmeOnly_OMEGA_marker";

const control = new Database(CONTROL);
control.pragma("journal_mode = WAL");

function mintSession(userId, activeTenantId) {
  const token = crypto.randomBytes(32).toString("hex");
  control
    .prepare(
      "INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(token, userId, activeTenantId ?? null, Date.now() + 600_000);
  return token;
}

function insertClient(dbPath, first) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const info = db
    .prepare(
      "INSERT INTO clients (first_name, last_name, phone) VALUES (?, 'TestMarker', '0000000000')",
    )
    .run(first);
  db.close();
  return Number(info.lastInsertRowid);
}

async function getClientsHtml(token) {
  const res = await fetch(`${BASE}/clients`, {
    headers: { cookie: `clientflow_session=${token}` },
    redirect: "manual",
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    html: await res.text(),
  };
}

const created = { acmeTenantId: null, acmeAdminId: null, renovaClientId: null };
const sessions = [];

async function main() {
  // 1. Resolve renova + platform admin from the control plane.
  const renova = control
    .prepare("SELECT * FROM tenants WHERE slug = 'renova'")
    .get();
  if (!renova) throw new Error("renova tenant not registered — boot migration didn't run");
  const owner = control
    .prepare("SELECT * FROM users WHERE is_platform_admin = 1 AND is_active = 1 LIMIT 1")
    .get();
  if (!owner) throw new Error("no platform admin in control.db");
  console.log(`renova tenant id=${renova.id} dbFile=${renova.db_file}; owner=${owner.email}`);

  // 2. Provision acme via the platform endpoint.
  const ownerToken = mintSession(owner.id, renova.id);
  sessions.push(ownerToken);
  const provRes = await fetch(`${BASE}/api/internal/tenants`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `clientflow_session=${ownerToken}` },
    body: JSON.stringify({
      slug: "acme",
      name: "Acme Clinic",
      admin: { email: "acme-admin@test.local", password: "acmepass123", name: "Acme Admin" },
    }),
  });
  const prov = await provRes.json().catch(() => ({}));
  if (!provRes.ok) throw new Error(`provision failed: ${JSON.stringify(prov)}`);
  created.acmeTenantId = prov.tenant.id;
  console.log(`provisioned acme tenant id=${prov.tenant.id} dbFile=${prov.tenant.dbFile}`);

  const acmeAdmin = control
    .prepare("SELECT * FROM users WHERE email = 'acme-admin@test.local'")
    .get();
  created.acmeAdminId = acmeAdmin.id;
  // Identity is no longer bound via users.tenant_id — it's a membership now.
  const acmeMembership = control
    .prepare("SELECT * FROM memberships WHERE user_id = ? AND tenant_id = ?")
    .get(acmeAdmin.id, created.acmeTenantId);
  if (!acmeMembership || acmeMembership.role !== "admin")
    throw new Error("acme admin has no admin membership in acme tenant");

  // 3. Seed a unique client into each tenant DB.
  created.renovaClientId = insertClient(path.join(DATA, renova.db_file), RENOVA_TOKEN);
  insertClient(path.join(DATA, prov.tenant.dbFile), ACME_TOKEN);
  console.log("seeded marker clients into both tenants");

  // 4. Separate-identity isolation: renova owner vs acme admin.
  const ownerView = await getClientsHtml(ownerToken);
  const acmeToken = mintSession(acmeAdmin.id, created.acmeTenantId);
  sessions.push(acmeToken);
  const acmeView = await getClientsHtml(acmeToken);

  // 5. Multi-account: grant the OWNER a membership in acme, then prove that ONE
  //    identity, switching its active clinic, flips which data it sees.
  control
    .prepare(
      "INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'admin', 1)",
    )
    .run(owner.id, created.acmeTenantId);
  const ownerAtRenova = mintSession(owner.id, renova.id);
  const ownerAtAcme = mintSession(owner.id, created.acmeTenantId);
  sessions.push(ownerAtRenova, ownerAtAcme);
  const switchRenova = await getClientsHtml(ownerAtRenova);
  const switchAcme = await getClientsHtml(ownerAtAcme);

  // 6. Revoke the owner's acme membership while a session is active there; the
  //    next request must fail closed and bounce to /select-account.
  control
    .prepare("DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?")
    .run(owner.id, created.acmeTenantId);
  const afterRevoke = await getClientsHtml(ownerAtAcme);

  const checks = [
    ["renova owner sees its own client", ownerView.html.includes(RENOVA_TOKEN), true],
    ["renova owner does NOT see acme client", ownerView.html.includes(ACME_TOKEN), false],
    ["acme admin sees its own client", acmeView.html.includes(ACME_TOKEN), true],
    ["acme admin does NOT see renova client", acmeView.html.includes(RENOVA_TOKEN), false],
    ["one identity @renova sees renova data", switchRenova.html.includes(RENOVA_TOKEN), true],
    ["one identity @renova hides acme data", switchRenova.html.includes(ACME_TOKEN), false],
    ["same identity switched @acme sees acme data", switchAcme.html.includes(ACME_TOKEN), true],
    ["same identity switched @acme hides renova data", switchAcme.html.includes(RENOVA_TOKEN), false],
    [
      "revoked-mid-session bounces to /select-account",
      afterRevoke.status >= 300 &&
        afterRevoke.status < 400 &&
        (afterRevoke.location || "").includes("/select-account"),
      true,
    ],
  ];
  console.log(
    `\n  separate: owner=${ownerView.status} acme=${acmeView.status} | switch: renova=${switchRenova.status} acme=${switchAcme.status} | revoked=${afterRevoke.status}->${afterRevoke.location}\n`,
  );

  let allPass = true;
  for (const [label, actual, expected] of checks) {
    const pass = actual === expected;
    allPass = allPass && pass;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  }
  console.log(`\n${allPass ? "✅ ISOLATION VERIFIED" : "❌ ISOLATION FAILED"}\n`);
  return allPass;
}

let ok = false;
try {
  ok = await main();
} catch (e) {
  console.error("ERROR:", e.message);
} finally {
  // Cleanup — best effort.
  try {
    for (const t of sessions)
      control.prepare("DELETE FROM auth_sessions WHERE id = ?").run(t);
    if (created.renovaClientId) {
      const cdb = new Database(path.join(DATA, "clinic.db"));
      cdb.prepare("DELETE FROM clients WHERE id = ?").run(created.renovaClientId);
      cdb.close();
    }
    if (created.acmeAdminId)
      control.prepare("DELETE FROM users WHERE id = ?").run(created.acmeAdminId);
    if (created.acmeTenantId)
      control.prepare("DELETE FROM tenants WHERE id = ?").run(created.acmeTenantId);
    const acmeDir = path.join(DATA, "tenants", "acme");
    if (fs.existsSync(acmeDir)) fs.rmSync(acmeDir, { recursive: true, force: true });
    console.log("cleaned up throwaway tenant + markers");
  } catch (e) {
    console.error("cleanup warning:", e.message);
  }
  control.close();
  process.exit(ok ? 0 : 1);
}
