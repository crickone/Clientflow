// Run: npm test -- src/lib/imapEmail.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

// imapEmail.ts now imports lib/db/tenant (getTenantDbById, for smtpSend's
// bookkeeping insert), which imports React's server-only `cache` at module
// load. Under the runner's `--conditions=react-server`, npm's react
// "react-server" entry point is a stub that THROWS on load — shim `react`
// with an identity `cache` BEFORE imapEmail.ts (or anything else) is
// required, so the real code path loads unchanged (same issue + fix as
// db/tenant.test.ts / platform/queries.test.ts). Installed via a dynamic
// require (below) rather than a static import, since a static
// `import ... from "./imapEmail"` would be hoisted and evaluated before
// this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
const {
  deleteImapConnection,
  getImapConnection,
  getImapCredentials,
  isImapConnected,
  saveImapConnection,
  threadKeyFor,
} = requireLocal("./imapEmail") as typeof import("./imapEmail");

// ─── threadKeyFor (pure — no DB, no network) ──────────────────────────────
// smtpSend/testImapConnection themselves are network paths, not unit-tested
// here (see Task 2 brief) — but the pure logic they lean on is.

assert.equal(
  threadKeyFor({
    messageId: "<new@x>",
    inReplyTo: "<mid@x>",
    references: ["<root@x>", "<mid@x>"],
  }),
  "<root@x>",
  "references array → its root (first) entry, ahead of inReplyTo/messageId",
);

assert.equal(
  threadKeyFor({
    messageId: "<new@x>",
    inReplyTo: "<mid@x>",
    references: "<root@x> <mid@x> <new@x>",
  }),
  "<root@x>",
  "string references → first whitespace-separated token",
);

assert.equal(
  threadKeyFor({ messageId: "<new@x>", inReplyTo: "<parent@x>", references: null }),
  "<parent@x>",
  "no references → falls back to inReplyTo",
);

assert.equal(
  threadKeyFor({ messageId: "<solo@x>", inReplyTo: null, references: null }),
  "<solo@x>",
  "no references/inReplyTo → falls back to messageId",
);

assert.equal(
  threadKeyFor({ messageId: null, inReplyTo: null, references: null }),
  null,
  "nothing present → null",
);

assert.equal(threadKeyFor({}), null, "all fields omitted (undefined) → null");

assert.equal(
  threadKeyFor({ messageId: "<solo@x>", inReplyTo: "   ", references: [] }),
  "<solo@x>",
  "blank inReplyTo + empty references array both fall through → messageId",
);

assert.equal(
  threadKeyFor({ messageId: "  <padded@x>  ", inReplyTo: null, references: undefined }),
  "<padded@x>",
  "surrounding whitespace is trimmed off the returned key",
);

assert.equal(
  threadKeyFor({ messageId: "<solo@x>", inReplyTo: undefined, references: "   " }),
  "<solo@x>",
  "whitespace-only references string falls through → messageId",
);

console.log("imapEmail.test.ts: threadKeyFor assertions passed");

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
