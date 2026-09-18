// Run: npm test -- src/lib/platform/integrations.test.ts
//
// Platform Console v2, slice 3 (Integrations). The property that matters
// most here is a negative one: NO SECRET LEAVES THE SERVER. A refresh
// token, a page access token, an IMAP password and an API key body all sit
// in the rows this board is built from, and the board is sent to a separate
// app over HTTP.
//
// So this test seeds a tenant whose every connection holds a recognisable
// secret, serialises the whole board the way the route does, and asserts
// that none of those strings appears anywhere in it. It also checks the
// states the board reports (connected / needs attention / not connected)
// and that revoking an API key is reflected and cannot be repeated.
//
// The disconnect paths that call out to Mailgun or Meta are not exercised;
// the ones that are purely local (api key revoke) are.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in integrations.test.ts"); } };
  }
  if (request === "next/headers") {
    return { cookies: () => { throw new Error("no request scope"); }, headers: () => { throw new Error("no request scope"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const integrations = requireLocal("./integrations") as typeof import("./integrations");
  const { generateApiKey } = requireLocal("../apiKeys") as typeof import("../apiKeys");

  const slug = "integrations-test";
  const tid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "Integrations Test", `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;
  const emptyTid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(`${slug}-empty`, "Integrations Empty", `tenants/${slug}-empty/x.db`) as { id: number }
  ).id;

  // Every secret this tenant holds, each a distinctive string we can search for.
  const SECRETS = {
    gmailRefresh: "SECRET-gmail-refresh-zzz",
    gmailAccess: "SECRET-gmail-access-zzz",
    imapPassword: "SECRET-imap-password-zzz",
    pageToken: "SECRET-fb-page-token-zzz",
  };

  const cleanup = () => {
    for (const t of [tid, emptyTid]) {
      for (const table of ["gmail_connections", "imap_connections", "facebook_pages", "api_keys", "site_domains", "sending_domains"]) {
        try {
          controlSqlite.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(t);
        } catch {
          // a table this build does not have
        }
      }
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t);
    }
  };

  try {
    // ── a tenant with nothing connected ──────────────────────────────────
    const empty = integrations.listTenantIntegrations(emptyTid);
    const emptyByKey = new Map(empty.connections.map((c) => [c.key, c]));
    for (const key of ["gmail", "imap", "sending_domain", "facebook", "meta_posting"]) {
      assert.equal(emptyByKey.get(key)?.state, "not_connected", `${key} reads as not connected`);
      assert.deepEqual(emptyByKey.get(key)?.actions, [], `${key} offers no actions when absent`);
    }
    assert.equal(empty.apiKeys.length, 0);
    assert.equal(empty.siteDomains.length, 0);
    assert.match(
      emptyByKey.get("meta_posting")!.detail ?? "",
      /wait until this is connected/i,
      "the posting row explains what it means for scheduled posts",
    );

    // ── seed every connection, each holding a secret ─────────────────────
    controlSqlite
      .prepare(
        "INSERT INTO gmail_connections (tenant_id, email, refresh_token, access_token, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(tid, "inbox@test.local", SECRETS.gmailRefresh, SECRETS.gmailAccess, "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.file", Date.now());
    controlSqlite
      .prepare(
        `INSERT INTO imap_connections (tenant_id, email, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, password_enc, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, ?, ?)`,
      )
      .run(tid, "mail@test.local", "imap.test.local", 993, "smtp.test.local", 465, "mail@test.local", SECRETS.imapPassword, Date.now());
    controlSqlite
      .prepare(
        "INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token, subscribed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(tid, "111222333", "The Test Gym", SECRETS.pageToken, Date.now(), Date.now());
    // A second page that never got subscribed: the board must flag it.
    controlSqlite
      .prepare("INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(tid, "444555666", "Unsubscribed Page", SECRETS.pageToken, Date.now());
    controlSqlite
      .prepare("INSERT INTO site_domains (host, tenant_id, site_id, is_primary, verify_token, created_at) VALUES (?, ?, ?, 1, 'tok', ?)")
      .run("www.testgym.ie", tid, 1, Date.now());

    const generated = generateApiKey(tid, "Make.com scenario", "leads:write");

    // ── the board reports the right states ───────────────────────────────
    const board = integrations.listTenantIntegrations(tid);
    const byKey = new Map(board.connections.map((c) => [c.key, c]));
    assert.equal(byKey.get("gmail")!.state, "connected");
    assert.equal(byKey.get("gmail")!.identity, "inbox@test.local");
    assert.match(byKey.get("gmail")!.detail ?? "", /Drive access granted/i, "the drive scope is reported from the scope string");
    assert.ok(byKey.get("gmail")!.connectedAt, "connected-at is read even though the safe view omits it");

    assert.equal(byKey.get("imap")!.state, "connected");
    assert.equal(byKey.get("imap")!.detail, "imap.test.local:993");

    assert.equal(byKey.get("facebook:111222333")!.state, "connected");
    assert.equal(byKey.get("facebook:444555666")!.state, "needs_attention", "a page connected but not subscribed needs attention");
    assert.equal(byKey.has("facebook"), false, "the placeholder row is dropped once real pages exist");

    assert.equal(board.apiKeys.length, 1);
    assert.equal(board.apiKeys[0].label, "Make.com scenario");
    assert.equal(board.siteDomains.length, 1);
    assert.equal(board.siteDomains[0].host, "www.testgym.ie");
    assert.equal(board.siteDomains[0].verifiedAt, null, "an unverified domain says so");

    // ── THE PROPERTY: no secret is anywhere in what the console receives ──
    const wire = JSON.stringify(board);
    for (const [name, secret] of Object.entries(SECRETS)) {
      assert.equal(wire.includes(secret), false, `${name} does not appear in the board sent to the console`);
    }
    assert.equal(wire.includes(generated.key), false, "the API key body does not appear either");
    assert.ok(wire.includes(generated.prefix), "…only its prefix, which is what identifies it");

    // ── revoking a key ───────────────────────────────────────────────────
    const revoked = integrations.revokeTenantApiKey(tid, board.apiKeys[0].id);
    assert.ok(revoked.ok, "a live key can be revoked");
    const after = integrations.listTenantIntegrations(tid);
    assert.ok(after.apiKeys[0].revokedAt, "the key now reads as revoked");
    assert.equal(integrations.revokeTenantApiKey(tid, board.apiKeys[0].id).ok, false, "revoking twice is refused");
    assert.equal(integrations.revokeTenantApiKey(tid, 999_999).ok, false, "an unknown key is refused");

    // ── disconnecting what is local ──────────────────────────────────────
    assert.equal((await integrations.disconnectIntegration(tid, "nonsense")).ok, false, "an unknown connection cannot be disconnected");
    assert.equal((await integrations.disconnectIntegration(emptyTid, "gmail")).ok, false, "disconnecting what is not connected is refused");

    const goneGmail = await integrations.disconnectIntegration(tid, "gmail");
    assert.ok(goneGmail.ok, "Gmail disconnects");
    assert.equal(integrations.listTenantIntegrations(tid).connections.find((c) => c.key === "gmail")!.state, "not_connected");

    const goneImap = await integrations.disconnectIntegration(tid, "imap");
    assert.ok(goneImap.ok, "IMAP disconnects");
    assert.equal(integrations.listTenantIntegrations(tid).connections.find((c) => c.key === "imap")!.state, "not_connected");

    console.log("integrations.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
