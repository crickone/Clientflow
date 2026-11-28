// Run: npm test -- src/lib/clientAccess.password.test.ts
//
// A member's app password, against a real scratch tenant:
//   1. the password a coach resets to is exactly the one that signs in;
//   2. getClientPasswordHash / restoreClientPasswordHash put an old password
//      back (used when emailing a new one fails);
//   3. both only touch this business's login.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("./db/tenant") as typeof import("./db/tenant");
  const { enableClientLogin, resetClientPassword, getClientPasswordHash, restoreClientPasswordHash } = requireLocal("./clientAccess") as typeof import("./clientAccess");
  const { loginClient } = requireLocal("./clientAuth") as typeof import("./clientAuth");

  const slugs = ["client-password-test-a", "client-password-test-b"];
  const email = "password-test-member@local.test";
  const other = "password-test-other@local.test";
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM client_credentials WHERE email IN (?, ?)").run(email, other);
    for (const s of slugs) {
      controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(s);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", s), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };
  cleanup();
  const [ta, tb] = slugs.map(
    (s) => (controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(s, s, `tenants/${s}/${s}.db`) as { id: number }).id,
  );

  let passed = 0;
  const ok = (name: string, cond: boolean) => {
    assert.ok(cond, name);
    passed++;
  };

  try {
    getTenantDbById(ta);
    getTenantDbById(tb);
    runWithTenant(tb, () => {
      ok("other business: login made", enableClientLogin(7, other, "otherpass1").ok);
    });
    runWithTenant(ta, () => {
      ok("login made", enableClientLogin(7, email, "firstpass1").ok);
      ok("first password signs in", loginClient(email, "firstpass1") !== null);

      ok("reset ok", resetClientPassword(7, "Welcome1").ok);
      ok("reset password signs in exactly", loginClient(email, "Welcome1") !== null);
      ok("a different case does not", loginClient(email, "welcome1") === null);
      ok("old password no longer signs in", loginClient(email, "firstpass1") === null);

      const kept = getClientPasswordHash(7);
      ok("hash read", typeof kept === "string" && kept.length > 0);
      resetClientPassword(7, "cf-temp123");
      ok("temp signs in", loginClient(email, "cf-temp123") !== null);
      restoreClientPasswordHash(7, kept!);
      ok("restored: the earlier password signs in again", loginClient(email, "Welcome1") !== null);
      ok("restored: the temp no longer does", loginClient(email, "cf-temp123") === null);
      ok("no login: null hash", getClientPasswordHash(999) === null);
    });
    ok("other business's login untouched", loginClient(other, "otherpass1") !== null);
  } finally {
    cleanup();
  }
  console.log(`clientAccess.password.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
