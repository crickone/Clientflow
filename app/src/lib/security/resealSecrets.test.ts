// Run: npm test -- src/lib/security/resealSecrets.test.ts
//
// EMAIL_TOKEN_SECRET could not be rotated: changing it made every stored
// token, API key and password unreadable at once. Now: set the new secret
// plus EMAIL_TOKEN_SECRET_PREVIOUS, everything still decrypts, the sweep
// re-encrypts it under the new key, and the old key can then be dropped.
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
  const before = { cur: process.env.EMAIL_TOKEN_SECRET, prev: process.env.EMAIL_TOKEN_SECRET_PREVIOUS };
  const crypto = requireLocal("../google/tokenCrypto") as typeof import("../google/tokenCrypto");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { resealAllSecrets } = requireLocal("./resealSecrets") as typeof import("./resealSecrets");

  const slug = "reseal-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Reseal Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM meta_grants WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM facebook_pages WHERE page_id = 'rs-page'").run();
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    process.env.EMAIL_TOKEN_SECRET = before.cur;
    if (before.prev === undefined) delete process.env.EMAIL_TOKEN_SECRET_PREVIOUS;
    else process.env.EMAIL_TOKEN_SECRET_PREVIOUS = before.prev;
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    // Sealed under the OLD key.
    process.env.EMAIL_TOKEN_SECRET = "old-secret-0000000000000000000000";
    delete process.env.EMAIL_TOKEN_SECRET_PREVIOUS;
    controlSqlite.prepare("INSERT INTO meta_grants (tenant_id, token_enc, token_kind, created_at, updated_at) VALUES (?, ?, 'user', 1, 1)").run(tid, crypto.encryptToken("grant-token"));
    controlSqlite.prepare("INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token) VALUES (?, 'rs-page', 'P', ?)").run(tid, "enc1:" + crypto.encryptToken("page-token"));
    const [site] = getTenantDbById(tid).insert(schema.sites).values({ slug: "reseal-site", name: "S", metaCapiToken: crypto.encryptToken("capi-token") } as typeof schema.sites.$inferInsert).returning().all();
    getTenantDbById(tid).insert(schema.settings).values({ key: "whatsapp_config", value: JSON.stringify({ provider: "whapi", tokenEnc: crypto.encryptToken("whapi-token") }) }).run();

    // Switch keys without the previous one: unreadable (the old behaviour).
    process.env.EMAIL_TOKEN_SECRET = "new-secret-1111111111111111111111";
    const grantRow = () => (controlSqlite.prepare("SELECT token_enc FROM meta_grants WHERE tenant_id = ?").get(tid) as { token_enc: string }).token_enc;
    assert.throws(() => crypto.decryptToken(grantRow()), "a new key alone cannot read the old secrets");

    // With the previous key: still readable, then re-encrypted by the sweep.
    process.env.EMAIL_TOKEN_SECRET_PREVIOUS = "old-secret-0000000000000000000000";
    assert.equal(crypto.decryptToken(grantRow()), "grant-token", "readable during the rotation");
    const report = resealAllSecrets();
    assert.ok(report.resealed >= 4, `re-encrypted (got ${report.resealed})`);
    assert.equal(resealAllSecrets().resealed, 0, "a second run has nothing left to do");

    // Old key gone: everything reads with the new key alone.
    delete process.env.EMAIL_TOKEN_SECRET_PREVIOUS;
    assert.equal(crypto.decryptToken(grantRow()), "grant-token");
    const page = (controlSqlite.prepare("SELECT page_access_token FROM facebook_pages WHERE page_id = 'rs-page'").get() as { page_access_token: string }).page_access_token;
    assert.ok(page.startsWith("enc1:"), "the sealed marker is kept");
    assert.equal(crypto.decryptToken(page.slice(5)), "page-token");
    const capi = getTenantDbById(tid).select({ t: schema.sites.metaCapiToken }).from(schema.sites).where(eq(schema.sites.id, site.id)).get()!.t!;
    assert.equal(crypto.decryptToken(capi), "capi-token");
    const wa = JSON.parse(getTenantDbById(tid).select().from(schema.settings).where(eq(schema.settings.key, "whatsapp_config")).get()!.value) as { tokenEnc: string; provider: string };
    assert.equal(crypto.decryptToken(wa.tokenEnc), "whapi-token");
    assert.equal(wa.provider, "whapi", "the rest of the settings row is untouched");

    console.log("resealSecrets: a full EMAIL_TOKEN_SECRET rotation, control and tenant secrets; 10 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
