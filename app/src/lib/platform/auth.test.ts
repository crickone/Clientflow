// Run: npm test -- src/lib/platform/auth.test.ts
//
// Deviation from the brief (documented in the Task 6 report):
// The brief's comment says to run this via `PLATFORM_API_KEY=test-key npx
// tsx ...`, but the full suite (`npm test`) runs every *.test.ts file
// without that env var set, which would fail this file's service-key
// assertions. Set it here instead so the file is self-sufficient under
// both `npm test` (whole suite) and a single-file run.
//
// `hashPassword` is imported from the leaf module `@/lib/password` (pure
// node:crypto, no react/next imports) rather than from `@/lib/auth` — that
// module imports `cache` from "react" and `cookies` from "next/headers" at
// its top level, which only resolve under Next's own bundler and crash this
// repo's plain-tsx test runner. `@/lib/platform/auth.ts`'s `verifyPassword`
// also imports from `@/lib/password`, so both sides of this round-trip share
// one source of truth for the `scrypt$<saltHex>$<hashHex>` format.
process.env.PLATFORM_API_KEY = "test-key";

import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import { hashPassword } from "../password";
import { checkServiceKey, platformLogin, requirePlatformSession, destroyPlatformSession } from "./auth";

const mkReq = (headers: Record<string, string>) => new Request("http://x/api/platform/x", { headers });

assert.equal(checkServiceKey(mkReq({ "x-platform-key": "test-key" })), true);
assert.equal(checkServiceKey(mkReq({ "x-platform-key": "wrong" })), false);
assert.equal(checkServiceKey(mkReq({})), false);

// Scratch platform-admin user
controlSqlite.prepare("DELETE FROM users WHERE email = 'pa-test@x.ie'").run();
const u = controlSqlite
  .prepare("INSERT INTO users (email, password_hash, role, is_platform_admin) VALUES ('pa-test@x.ie', ?, 'admin', 1) RETURNING id")
  .get(hashPassword("hunter22!")) as { id: number };
try {
  assert.equal(platformLogin("pa-test@x.ie", "nope").ok, false);
  const res = platformLogin("pa-test@x.ie", "hunter22!");
  assert.equal(res.ok, true);
  if (!res.ok) throw new Error("unreachable");
  const sess = requirePlatformSession(mkReq({ "x-admin-session": res.token }));
  assert.equal(sess.userId, u.id);
  assert.throws(() => requirePlatformSession(mkReq({ "x-admin-session": "bogus" })), /UNAUTHORIZED/);
  destroyPlatformSession(mkReq({ "x-admin-session": res.token }));
  assert.throws(() => requirePlatformSession(mkReq({ "x-admin-session": res.token })), /UNAUTHORIZED/);

  // A non-platform-admin cannot log in even with the right password
  controlSqlite.prepare("UPDATE users SET is_platform_admin = 0 WHERE id = ?").run(u.id);
  assert.equal(platformLogin("pa-test@x.ie", "hunter22!").ok, false);
  console.log("platform/auth.test.ts: all assertions passed");
} finally {
  controlSqlite.prepare("DELETE FROM platform_sessions WHERE user_id = ?").run(u.id);
  controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
}
