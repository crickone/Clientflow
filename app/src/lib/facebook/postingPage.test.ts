// Run: npm test -- src/lib/facebook/postingPage.test.ts
//
// Scheduled posts go out through ONE connected Page per tenant. getPostingPage
// honours the tenant's chosen Page while it is still connected, falls back to
// the earliest live Page otherwise, never crosses tenants, and stops returning
// a Page once it is disconnected (disconnect also wipes the stored token, as
// the public privacy policy promises).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

// The control DB's import graph reaches react's server `cache`; stub it like
// integrations.test.ts does.
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

  // disconnect calls Graph to unsubscribe the Page; never reach the network.
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

  const mk = (slug: string) =>
    (controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const a = mk("posting-page-test-a");
  const b = mk("posting-page-test-b");
  const insert = controlSqlite.prepare(
    "INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token, ig_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const cleanup = () => {
    for (const t of [a, b]) {
      controlSqlite.prepare("DELETE FROM facebook_pages WHERE tenant_id = ?").run(t);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t);
    }
  };

  try {
    assert.equal(pages.getPostingPage(a, null), null, "no Page connected -> nothing to post through");

    insert.run(a, "pt-first", "First", "tok-first", "ig-1", 1000);
    insert.run(a, "pt-second", "Second", "tok-second", null, 2000);
    insert.run(b, "pt-other", "Other tenant", "tok-other", null, 500);

    assert.equal(pages.getPostingPage(a, null)?.pageId, "pt-first", "default is the earliest-connected Page");
    assert.equal(pages.getPostingPage(a, null)?.igUserId, "ig-1", "carries the linked Instagram account");
    assert.equal(pages.getPostingPage(a, "pt-second")?.pageAccessToken, "tok-second", "honours the chosen Page");
    assert.equal(pages.getPostingPage(a, "pt-other")?.pageId, "pt-first", "another tenant's Page is never used");

    await pages.disconnectFacebookPage(a, "pt-second");
    assert.equal(pages.getPostingPage(a, "pt-second")?.pageId, "pt-first", "a disconnected choice falls back");
    const wiped = controlSqlite.prepare("SELECT page_access_token FROM facebook_pages WHERE page_id = ?").get("pt-second") as { page_access_token: string };
    assert.equal(wiped.page_access_token, "", "disconnect deletes the stored token");

    await pages.disconnectFacebookPage(a, "pt-first");
    assert.equal(pages.getPostingPage(a, null), null, "every Page disconnected -> nothing to post through");
    console.log("postingPage: 9 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
