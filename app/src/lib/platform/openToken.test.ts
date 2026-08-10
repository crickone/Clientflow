// Run: npm test -- src/lib/platform/openToken.test.ts
import assert from "node:assert/strict";

import { controlSqlite } from "../db/control";
import { createOpenToken, consumeOpenToken } from "./openToken";

// Scratch user + tenant the tokens are bound to.
controlSqlite.prepare("DELETE FROM users WHERE email = 'open-token-test@x.ie'").run();
controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'open-token-test'").run();

const u = controlSqlite
  .prepare(
    "INSERT INTO users (email, password_hash) VALUES ('open-token-test@x.ie', 'x') RETURNING id",
  )
  .get() as { id: number };
const t = controlSqlite
  .prepare(
    "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('open-token-test','Open Token Test','tenants/open-token-test/void.db',1) RETURNING id",
  )
  .get() as { id: number };

try {
  // Unknown token → null (never throws on garbage input).
  assert.equal(consumeOpenToken("does-not-exist"), null, "unknown token -> null");

  // Create → consume once → returns exactly the bound (userId, tenantId).
  const token = createOpenToken(u.id, t.id);
  assert.equal(typeof token, "string");
  // 32 bytes hex-encoded = 64 chars; ">=" so this still holds if the byte
  // length is ever increased, only fails if it drops below the ≥32-byte floor.
  assert.ok(token.length >= 64, "token is at least 32 bytes, hex-encoded");
  const claim = consumeOpenToken(token);
  assert.deepEqual(claim, { userId: u.id, tenantId: t.id });

  // A SECOND consume of the SAME token -> null (single-use / can't be replayed).
  assert.equal(consumeOpenToken(token), null, "replaying a used token -> null");

  // An expired token -> null. Insert one directly with expires_at already in
  // the past (createOpenToken's real TTL is ~60s — too slow to wait out here).
  const expiredToken = "expired-test-token";
  controlSqlite
    .prepare(
      "INSERT INTO platform_open_tokens (token, user_id, tenant_id, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(expiredToken, u.id, t.id, Date.now() - 1000);
  assert.equal(consumeOpenToken(expiredToken), null, "expired token -> null");
  // A failed (expired) consume must not itself burn the row — used_at stays
  // NULL — otherwise an unrelated bug could masquerade as "single-use" working.
  const expiredRow = controlSqlite
    .prepare("SELECT used_at FROM platform_open_tokens WHERE token = ?")
    .get(expiredToken) as { used_at: number | null };
  assert.equal(expiredRow.used_at, null, "a rejected (expired) consume leaves used_at untouched");

  console.log("platform/openToken.test.ts: all assertions passed");
} finally {
  controlSqlite.prepare("DELETE FROM platform_open_tokens WHERE user_id = ? OR tenant_id = ?").run(u.id, t.id);
  controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?").run(u.id, t.id);
  controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
}
