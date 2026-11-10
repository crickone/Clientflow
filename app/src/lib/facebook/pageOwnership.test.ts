// Run: npm test -- src/lib/facebook/pageOwnership.test.ts
//
// 2026-11-10: the never-expiring business login returned BOTH Pages the
// business integration had ever been given (Adonis Agent and Optimal Health)
// when only Optimal Health was ticked, and Meta does not say which were
// ticked. The old save connected every Page it was handed and reassigned a
// Page to whoever connected last, so the Adonis Agent Page moved into Optimal
// Health's account (its DMs and leads would have gone to the wrong business).
//
// The rules now:
//  1. Facebook's Pages are offers. Only a picked Page is connected, except the
//     one obvious case: a business with no Page, offered one free Page.
//  2. Ownership is one conditional write (claimPage): a Page live in another
//     business is never taken, whoever asks.
//  3. A disconnect sticks: a reconnect does not bring the Page back.
//  4. The same for ad accounts: another business's is listed, never usable.
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
  const grants = requireLocal("./grants") as typeof import("./grants");

  // Subscribe + unsubscribe calls: never reach the network.
  globalThis.fetch = (async () => new Response('{"success":true}', { status: 200 })) as typeof fetch;

  const mk = (slug: string) =>
    (controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const adonis = mk("page-owner-test-adonis");
  const clinic = mk("page-owner-test-clinic");
  const ownerOf = (pageId: string) =>
    controlSqlite.prepare("SELECT tenant_id, revoked_at FROM facebook_pages WHERE page_id = ?").get(pageId) as
      | { tenant_id: number; revoked_at: number | null }
      | undefined;
  const connectedTo = (t: number) => pages.listFacebookPages(t).map((p) => p.pageId).sort();
  const page = (id: string, name: string) => ({ id, name, access_token: `EAAtok${id}000000000000000000000000` });
  const ADONIS = page("po-adonis", "Adonis Agent");
  const CLINIC = page("po-clinic", "Optimal Health");
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM facebook_pages WHERE page_id LIKE 'po-%'").run();
    for (const t of [adonis, clinic]) {
      controlSqlite.prepare("DELETE FROM facebook_page_offers WHERE tenant_id = ?").run(t);
      controlSqlite.prepare("DELETE FROM facebook_ad_accounts WHERE tenant_id = ?").run(t);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t);
    }
  };

  try {
    // Adonis connects first and is handed only its own Page: the obvious case.
    let r = await pages.applyConnectedPages(adonis, [ADONIS], 1);
    assert.deepEqual(r, { connected: ["Adonis Agent"], waiting: 0 });

    // THE INCIDENT: Optimal Health connects and Facebook hands back both.
    r = await pages.applyConnectedPages(clinic, [ADONIS, CLINIC], 2);
    assert.equal(ownerOf("po-adonis")?.tenant_id, adonis, "the Adonis Page stays with Adonis");
    assert.deepEqual(r.connected, ["Optimal Health"], "the one free Page is connected");
    assert.deepEqual(connectedTo(clinic), ["po-clinic"]);
    assert.deepEqual(
      pages.listPageOffers(clinic).map((o) => [o.pageId, o.status]),
      [["po-adonis", "elsewhere"]],
      "the Adonis Page is listed as another business's, not offered",
    );

    // Two free Pages offered to a business with none: nothing is guessed.
    const third = mk("page-owner-test-third");
    try {
      r = await pages.applyConnectedPages(third, [page("po-x", "X"), page("po-y", "Y")], 3);
      assert.deepEqual(r, { connected: [], waiting: 2 }, "two candidates: the business picks");
      assert.deepEqual(connectedTo(third), []);
      // Picking one is a claim, and claims respect ownership.
      assert.equal(await pages.claimPage(third, page("po-x", "X"), 3), "connected");
      assert.equal(await pages.claimPage(third, ADONIS, 3), "elsewhere", "a Page live elsewhere is never taken");
      assert.equal(ownerOf("po-adonis")?.tenant_id, adonis);
    } finally {
      controlSqlite.prepare("DELETE FROM facebook_page_offers WHERE tenant_id = ?").run(third);
      controlSqlite.prepare("DELETE FROM facebook_pages WHERE tenant_id = ?").run(third);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(third);
    }

    // A reconnect refreshes the Pages a business has, and adds nothing else.
    r = await pages.applyConnectedPages(clinic, [ADONIS, CLINIC], 2);
    assert.deepEqual(connectedTo(clinic), ["po-clinic"]);

    // Disconnect sticks: reconnecting does not bring the Page back.
    await pages.disconnectFacebookPage(clinic, "po-clinic");
    r = await pages.applyConnectedPages(clinic, [ADONIS, CLINIC], 2);
    assert.deepEqual(connectedTo(clinic), [], "a disconnected Page is not reconnected by a reconnect");
    assert.equal(pages.listPageOffers(clinic).find((o) => o.pageId === "po-clinic")?.status, "available", "it can be picked again");
    assert.equal(await pages.claimPage(clinic, CLINIC, 2), "connected");

    // Moving a Page on purpose: disconnect where it is, then claim it.
    await pages.disconnectFacebookPage(adonis, "po-adonis");
    assert.equal(await pages.claimPage(clinic, ADONIS, 2), "connected");
    assert.equal(ownerOf("po-adonis")?.tenant_id, clinic);
    assert.equal(ownerOf("po-adonis")?.revoked_at, null);

    // Ad accounts: the same rule.
    grants.saveAdAccounts(adonis, [{ id: "act_po1", name: "Adonis ads" }]);
    assert.equal(grants.listAdAccounts(adonis).length, 1, "one account, nobody else's: chosen");
    grants.saveAdAccounts(clinic, [{ id: "act_po1", name: "Adonis ads" }]);
    assert.equal(grants.listAdAccounts(clinic).length, 0, "another business's single account is not auto-chosen");
    assert.equal(grants.listAdAccounts(clinic, { granted: true })[0]?.usedElsewhere, true, "it is listed as used elsewhere");
    assert.equal(grants.setAdAccountInUse(clinic, "act_po1", true), false, "and cannot be chosen");
    grants.setAdAccountInUse(adonis, "act_po1", false);
    assert.equal(grants.setAdAccountInUse(clinic, "act_po1", true), true, "once Adonis stops using it, it can be");

    console.log("pageOwnership: offers not connections, atomic claims, sticky disconnects, ad accounts; 22 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
