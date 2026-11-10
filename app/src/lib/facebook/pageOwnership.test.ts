// Run: npm test -- src/lib/facebook/pageOwnership.test.ts
//
// The never-expiring business login returns every Page the business
// integration has been given, not only the ones ticked this time. Saving them
// used to MOVE a Page between businesses: reconnecting Optimal Health pulled
// the Adonis Agent Page out of the Adonis account (2026-11-10), so its
// messages and leads would have reached the wrong business. A Page connected
// to another business now stays there; a disconnected one can be taken.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const pages = requireLocal("./pages") as typeof import("./pages");

  // Subscribe + unsubscribe calls: never reach the network.
  globalThis.fetch = (async () => new Response('{"success":true}', { status: 200 })) as typeof fetch;

  const mk = (slug: string) =>
    (controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const platform = mk("page-owner-test-platform");
  const clinic = mk("page-owner-test-clinic");
  const ownerOf = (pageId: string) =>
    (controlSqlite.prepare("SELECT tenant_id, revoked_at FROM facebook_pages WHERE page_id = ?").get(pageId) as
      | { tenant_id: number; revoked_at: number | null }
      | undefined);
  const page = (id: string, name: string) => ({ id, name, access_token: `EAAtok${id}000000000000000000000000` });
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM facebook_pages WHERE page_id LIKE 'po-%'").run();
    for (const t of [platform, clinic]) controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t);
  };

  try {
    // The platform business connects its own Page.
    let r = await pages.saveConnectedPages(platform, [page("po-adonis", "Adonis Agent")], 1);
    assert.deepEqual(r, { connected: ["Adonis Agent"], leftWithOther: [] });

    // The clinic connects; Facebook hands back both Pages.
    r = await pages.saveConnectedPages(clinic, [page("po-adonis", "Adonis Agent"), page("po-clinic", "Clinic")], 2);
    assert.deepEqual(r, { connected: ["Clinic"], leftWithOther: ["Adonis Agent"] });
    assert.equal(ownerOf("po-adonis")?.tenant_id, platform, "the other business's Page stays with it");
    assert.equal(ownerOf("po-clinic")?.tenant_id, clinic);

    // The platform reconnects later and is handed the clinic's Page: same rule.
    r = await pages.saveConnectedPages(platform, [page("po-adonis", "Adonis Agent"), page("po-clinic", "Clinic")], 1);
    assert.deepEqual(r, { connected: ["Adonis Agent"], leftWithOther: ["Clinic"] });
    assert.equal(ownerOf("po-clinic")?.tenant_id, clinic);

    // Moving a Page on purpose: disconnect it where it is, then connect it here.
    await pages.disconnectFacebookPage(platform, "po-adonis");
    r = await pages.saveConnectedPages(clinic, [page("po-adonis", "Adonis Agent")], 2);
    assert.deepEqual(r, { connected: ["Adonis Agent"], leftWithOther: [] });
    assert.equal(ownerOf("po-adonis")?.tenant_id, clinic);
    assert.equal(ownerOf("po-adonis")?.revoked_at, null, "reconnecting clears the disconnect");

    // A business reconnecting its own Page keeps it.
    r = await pages.saveConnectedPages(clinic, [page("po-clinic", "Clinic")], 2);
    assert.deepEqual(r.connected, ["Clinic"]);
    console.log("pageOwnership: a reconnect never moves another business's Page; 10 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
