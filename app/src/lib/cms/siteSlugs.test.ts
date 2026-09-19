// Run: npm test -- src/lib/cms/siteSlugs.test.ts
//
// A CMS site slug is the public URL (/site/<slug>/...) and resolveHost serves
// the FIRST active tenant holding it. So the same slug in two tenants does not
// coexist: one of the two websites becomes unreachable, and which one depends
// on registry order, which nobody thinks about when creating a site.
//
// This is not hypothetical. tools/import-site.cjs used to default its target
// database to the legacy tenant's file, so the Inspire site was imported there
// and shadowed the copy in Inspire's own tenant. Both claimed the same domain.
// Edits to the visible copy were invisible; edits to the invisible copy looked
// like failures; a deploy that correctly published nine pages reported success
// while the website did not change. It took a production log line to find.
//
// These are the rules that stop it recurring.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "siteslugs-"));
const ORIGINAL_CWD = process.cwd();
process.chdir(SANDBOX);

(async () => {
  try {
    const { findSiteSlugOwners, findDuplicateSiteSlugs } = await import("./siteSlugs");
    const { controlSqlite } = await import("../db/control");
    const { openTenantDb } = await import("../db/tenant");

    const makeTenant = (slug: string, name: string) => {
      controlSqlite
        .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1)")
        .run(slug, name, `tenants/${slug}/${slug}.db`);
      return (
        controlSqlite.prepare("SELECT id, db_file FROM tenants WHERE slug = ?").get(slug) as {
          id: number;
          db_file: string;
        }
      );
    };
    const addSite = (dbFile: string, siteSlug: string) => {
      const { sqlite } = openTenantDb(dbFile);
      sqlite.prepare("INSERT INTO sites (slug, name, status) VALUES (?, ?, 'live')").run(siteSlug, siteSlug);
    };

    // Registry order is insertion order, and the renderer scans it in that
    // order, so "legacy" here plays the part the Renova tenant played.
    const legacy = makeTenant("legacy", "Legacy Business");
    const client = makeTenant("client", "The Client");
    const third = makeTenant("third", "Third Business");

    // ── nothing to find ────────────────────────────────────────────────────
    assert.deepEqual(findSiteSlugOwners("nowhere"), [], "an unknown slug has no owners");
    assert.deepEqual(findDuplicateSiteSlugs(), [], "a fleet with no sites has no duplicates");

    // ── one owner ──────────────────────────────────────────────────────────
    addSite(client.db_file, "gym");
    const single = findSiteSlugOwners("gym");
    assert.equal(single.length, 1, "one tenant, one owner");
    assert.equal(single[0].tenantSlug, "client");
    assert.equal(single[0].tenantName, "The Client", "the owner carries a human-readable name for messages");
    assert.deepEqual(findDuplicateSiteSlugs(), [], "one owner is not a duplicate");

    // ── THE BUG: the same slug in two tenants ──────────────────────────────
    addSite(legacy.db_file, "gym");
    const both = findSiteSlugOwners("gym");
    assert.equal(both.length, 2, "both tenants are found");
    assert.equal(
      both[0].tenantSlug,
      "legacy",
      "THE FIRST OWNER IS THE ONE SERVED — registry order, exactly as resolveHost scans it",
    );
    assert.equal(both[1].tenantSlug, "client", "…and the client's own copy is the shadowed one");

    const dupes = findDuplicateSiteSlugs();
    assert.equal(dupes.length, 1, "the duplicate is reported");
    assert.equal(dupes[0].slug, "gym");
    assert.deepEqual(
      dupes[0].owners.map((o) => o.tenantSlug),
      ["legacy", "client"],
      "…naming every tenant holding it, served-first",
    );

    // ── an inactive tenant is not an owner ─────────────────────────────────
    // The renderer skips inactive tenants, so counting one as an owner would
    // block a slug that is actually free, and point the publisher at a
    // database nobody serves from.
    addSite(third.db_file, "solo");
    controlSqlite.prepare("UPDATE tenants SET is_active = 0 WHERE id = ?").run(third.id);
    assert.deepEqual(findSiteSlugOwners("solo"), [], "an archived tenant does not own a slug");
    assert.equal(
      findDuplicateSiteSlugs().length,
      1,
      "…and cannot create a phantom duplicate",
    );
    controlSqlite.prepare("UPDATE tenants SET is_active = 1 WHERE id = ?").run(third.id);

    // ── case and whitespace ────────────────────────────────────────────────
    assert.equal(findSiteSlugOwners("  GYM  ").length, 2, "lookup is trimmed and case-insensitive");
    assert.deepEqual(findSiteSlugOwners(""), [], "an empty slug owns nothing");
    assert.deepEqual(findSiteSlugOwners("   "), [], "…and neither does whitespace");

    // ── a third holder is still ordered correctly ──────────────────────────
    addSite(third.db_file, "gym");
    const three = findSiteSlugOwners("gym");
    assert.deepEqual(
      three.map((o) => o.tenantSlug),
      ["legacy", "client", "third"],
      "every holder, still in the order the renderer would try them",
    );
    const worst = findDuplicateSiteSlugs();
    assert.equal(worst[0].slug, "gym", "the worst duplicate is reported first");
    assert.equal(worst[0].owners.length, 3);

    console.log("siteSlugs.test.ts: all assertions passed");
  } finally {
    process.chdir(ORIGINAL_CWD);
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
