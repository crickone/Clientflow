// Run: npm test -- src/lib/security/tokenKey.test.ts
//
// Bearer tokens (sessions, reset and invite links, console open links) are
// stored hashed. Existing raw rows are converted at boot so people stay
// signed in, the conversion never double-hashes, and a stored value is not
// itself a working token.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

import { tokenKey, TOKEN_COLUMNS } from "./tokenKey";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

const k = tokenKey("abc");
assert.match(k, /^h1:[0-9a-f]{64}$/);
assert.equal(tokenKey("abc"), k, "deterministic");
assert.notEqual(tokenKey(k), k, "a stored value hashed again matches nothing");
assert.ok(TOKEN_COLUMNS.some((c) => c.table === "auth_sessions") && TOKEN_COLUMNS.length === 7);

const { controlSqlite, hashStoredTokens } = requireLocal("../db/control") as typeof import("../db/control");
const user = controlSqlite.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number } | undefined;
if (user) {
  const raw = `tk-test-${Date.now()}`;
  try {
    controlSqlite.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(raw, user.id, Date.now() + 60_000);
    assert.ok(hashStoredTokens() >= 1, "a raw session from before the change is converted");
    assert.ok(controlSqlite.prepare("SELECT 1 FROM auth_sessions WHERE id = ?").get(tokenKey(raw)), "and found by hashing the cookie");
    assert.equal(controlSqlite.prepare("SELECT 1 FROM auth_sessions WHERE id = ?").get(raw), undefined, "the raw token is no longer stored");
    hashStoredTokens();
    assert.ok(controlSqlite.prepare("SELECT 1 FROM auth_sessions WHERE id = ?").get(tokenKey(raw)), "running again does not double-hash");
  } finally {
    controlSqlite.prepare("DELETE FROM auth_sessions WHERE id IN (?, ?)").run(raw, tokenKey(raw));
  }
}
console.log("tokenKey: hashed storage, boot conversion, no double-hashing; checks passed.");
