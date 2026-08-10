// Run: npm test -- src/lib/imapEmail.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "./db/control";
import {
  deleteImapConnection,
  getImapConnection,
  getImapCredentials,
  isImapConnected,
  saveImapConnection,
} from "./imapEmail";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as apiKeys.test.ts).
(async () => {
  // ── scratch tenant (control row only) ──
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'imap-email-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('imap-email-test','IMAP Email Test','tenants/imap-email-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM imap_connections WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // nothing connected yet
    assert.equal(isImapConnected(tid), false, "not connected before save");
    assert.equal(getImapConnection(tid), null);
    assert.equal(getImapCredentials(tid), null);

    const PLAINTEXT_PASSWORD = "s3cr3t-mailbox-password";

    saveImapConnection({
      tenantId: tid,
      email: "hello@example.com",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      username: "hello@example.com",
      password: PLAINTEXT_PASSWORD,
      fromName: "Example Clinic",
    });

    assert.equal(isImapConnected(tid), true, "connected after save");

    // save → get returns the safe shape (no password / ciphertext anywhere on it)
    const conn = getImapConnection(tid);
    assert.ok(conn);
    assert.deepEqual(conn, {
      tenantId: tid,
      email: "hello@example.com",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      username: "hello@example.com",
      fromName: "Example Clinic",
      lastSyncAt: null,
    });
    const leaked = conn as unknown as Record<string, unknown>;
    assert.equal(leaked.password, undefined, "safe shape has no password field");
    assert.equal(leaked.passwordEnc, undefined, "safe shape has no passwordEnc field");
    assert.equal(leaked.password_enc, undefined, "safe shape has no password_enc field");

    // the raw stored password_enc is NOT the plaintext
    const rawRow = controlSqlite
      .prepare("SELECT password_enc FROM imap_connections WHERE tenant_id = ?")
      .get(tid) as { password_enc: string };
    assert.ok(rawRow.password_enc, "password_enc is stored");
    assert.notEqual(rawRow.password_enc, PLAINTEXT_PASSWORD, "stored value is not the plaintext");
    assert.ok(
      !rawRow.password_enc.includes(PLAINTEXT_PASSWORD),
      "ciphertext does not even contain the plaintext as a substring",
    );

    // getImapCredentials decrypts back to the original password
    const creds = getImapCredentials(tid);
    assert.ok(creds);
    assert.equal(creds!.password, PLAINTEXT_PASSWORD, "decrypts back to the original password");
    assert.equal(creds!.email, "hello@example.com");
    assert.equal(creds!.imapHost, "imap.example.com");
    assert.equal(creds!.imapPort, 993);
    assert.equal(creds!.smtpHost, "smtp.example.com");
    assert.equal(creds!.username, "hello@example.com");
    assert.equal(creds!.fromName, "Example Clinic");

    // save again (different values, fromName omitted) → UPSERT: updates in
    // place, still exactly one row for the tenant
    const NEW_PASSWORD = "rotated-password-2";
    saveImapConnection({
      tenantId: tid,
      email: "updated@example.com",
      imapHost: "imap2.example.com",
      imapPort: 143,
      imapSecure: false,
      smtpHost: "smtp2.example.com",
      smtpPort: 587,
      smtpSecure: false,
      username: "updated@example.com",
      password: NEW_PASSWORD,
    });

    const rowCount = controlSqlite
      .prepare("SELECT COUNT(*) as n FROM imap_connections WHERE tenant_id = ?")
      .get(tid) as { n: number };
    assert.equal(rowCount.n, 1, "UPSERT: still exactly one row for the tenant");

    const updated = getImapConnection(tid);
    assert.ok(updated);
    assert.equal(updated!.email, "updated@example.com");
    assert.equal(updated!.imapHost, "imap2.example.com");
    assert.equal(updated!.imapPort, 143);
    assert.equal(updated!.imapSecure, false);
    assert.equal(updated!.smtpSecure, false);
    assert.equal(updated!.fromName, null, "fromName omitted on second save → null, not stale");

    const updatedCreds = getImapCredentials(tid);
    assert.equal(updatedCreds!.password, NEW_PASSWORD, "password re-encrypted + decrypts on update");

    // delete removes it
    deleteImapConnection(tid);
    assert.equal(isImapConnected(tid), false, "disconnected after delete");
    assert.equal(getImapConnection(tid), null);
    assert.equal(getImapCredentials(tid), null);
    const afterDelete = controlSqlite
      .prepare("SELECT COUNT(*) as n FROM imap_connections WHERE tenant_id = ?")
      .get(tid) as { n: number };
    assert.equal(afterDelete.n, 0, "row actually removed, not just soft-hidden");

    console.log("imapEmail.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
