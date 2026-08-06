// Run: npm test -- src/lib/apiKeys.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "./db/control";
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
} from "./apiKeys";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as billing/engine.test.ts).
(async () => {
  // ── scratch tenant (control row only) ──
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'apikeys-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('apikeys-test','API Keys Test','tenants/apikeys-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM api_keys WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // generate → raw shown once; prefix is the non-secret leading slice.
    const { raw, prefix } = generateApiKey(tid, "Test key", "leads");
    assert.ok(raw.startsWith("cf_live_"), "raw key has the cf_live_ prefix");
    assert.equal(prefix, raw.slice(0, 14));
    assert.equal(raw.length, "cf_live_".length + 48); // 24 random bytes → 48 hex chars

    // verify(raw) → { tenantId, scopes }
    assert.deepEqual(verifyApiKey(raw), { tenantId: tid, scopes: "leads" });

    // list returns the row WITHOUT the hash/raw secret, with last_used_at bumped
    const listed = listApiKeys(tid);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].prefix, prefix);
    assert.equal(listed[0].label, "Test key");
    assert.equal(listed[0].scopes, "leads");
    assert.ok(listed[0].lastUsedAt != null, "verify() bumped last_used_at");
    const leaked = listed[0] as unknown as Record<string, unknown>;
    assert.equal(leaked.keyHash, undefined);
    assert.equal(leaked.key_hash, undefined);
    assert.equal(leaked.raw, undefined);

    // an unknown / malformed key → null
    assert.equal(verifyApiKey("cf_live_bad"), null);
    assert.equal(verifyApiKey(""), null);

    // revoke → verify → null; the row is still listed, now flagged revoked
    revokeApiKey(tid, listed[0].id);
    assert.equal(verifyApiKey(raw), null, "revoked key no longer verifies");
    const afterRevoke = listApiKeys(tid);
    assert.equal(afterRevoke.length, 1);
    assert.ok(afterRevoke[0].revokedAt != null);

    // revoke is tenant-scoped: a different tenant id can't revoke this key
    const second = generateApiKey(tid, "Second key", "leads");
    const secondId = listApiKeys(tid).find((k) => k.label === "Second key")!.id;
    revokeApiKey(-999, secondId); // wrong tenant → no-op
    assert.deepEqual(verifyApiKey(second.raw), { tenantId: tid, scopes: "leads" });

    console.log("apiKeys.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
