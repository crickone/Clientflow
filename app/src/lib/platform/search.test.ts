// Run: npm test -- src/lib/platform/search.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { searchPlatform } = requireLocal("./search") as typeof import("./search");

  const slug = "search-test-zq";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  controlSqlite.prepare("DELETE FROM users WHERE email = 'zq.search@example.test'").run();
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Zq Search Gym", `tenants/${slug}/void.db`) as { id: number };
  const u = controlSqlite
    .prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('zq.search@example.test', 'Zq Person', 'x', 'staff') RETURNING id")
    .get() as { id: number };
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)").run(u.id, t.id);
  controlSqlite.prepare("INSERT INTO site_domains (host, tenant_id, site_id) VALUES ('zq-search.example.test', ?, 1)").run(t.id);
  const inv = controlSqlite
    .prepare(
      `INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, gateway_ref)
       VALUES (?, '2026-01-01', '2026-01-31', 20000, 4600, 24600, 2300, 'zqref123') RETURNING id`,
    )
    .get(t.id) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM billing_invoices WHERE id = ?").run(inv.id);
    controlSqlite.prepare("DELETE FROM site_domains WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  };

  try {
    const kinds = (q: string) => searchPlatform(q).map((h) => h.kind);

    assert.ok(kinds("zq search").includes("business"), "name words in any order find the business");
    assert.ok(kinds(slug).includes("business"), "slug finds the business");
    const person = searchPlatform("zq.search@").find((h) => h.kind === "person");
    assert.ok(person, "email prefix finds the person");
    assert.equal(person.href, `/gyms/${t.id}/people`);
    assert.ok(kinds("zq-search.example").includes("domain"));
    const byRef = searchPlatform("zqref123").find((h) => h.kind === "invoice");
    assert.ok(byRef, "gateway ref finds the invoice");
    const byId = searchPlatform(`#${inv.id}`).find((h) => h.kind === "invoice");
    assert.ok(byId, "#id finds the invoice");
    assert.deepEqual(searchPlatform("x"), [], "a one-character query returns nothing");
    assert.ok(searchPlatform("zq", 1).length <= 1, "limit is honoured");

    console.log("search.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
