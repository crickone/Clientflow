// Run: npm test -- src/lib/vouchers/schema.test.ts
//
// The voucher store's data: the flag (off for everyone until switched on),
// the two new tables, and the new gift_vouchers columns with the unique
// gift-page token.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { MODULE_CATALOG, moduleForPath } = requireLocal("../features") as typeof import("../features");
  const { listPlatformFlags } = requireLocal("../platform/flags") as typeof import("../platform/flags");
  const { getTenantDbById, openTenantDb, ensureTenantTables } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const Database = requireLocal("better-sqlite3") as typeof import("better-sqlite3");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { withVoucherTenant } = requireLocal("./testSupport") as typeof import("./testSupport");

  const flag = MODULE_CATALOG.find((m) => m.key === "voucher_store");
  assert.ok(flag, "voucher_store is in the module catalog");
  assert.equal(flag.defaultRollout, "none", "off for every business until switched on");
  assert.deepEqual(flag.paths, ["/vouchers/store"]);
  assert.equal(moduleForPath("/vouchers/store")?.key, "voucher_store", "the store settings page is the store's");
  assert.equal(moduleForPath("/vouchers")?.key, "products", "the voucher list stays with products");

  await withVoucherTenant("voucher-schema-test", (tid) => {
    const on = listPlatformFlags().find((f) => f.key === "voucher_store");
    assert.ok(on && on.mode === "allow" && on.allow.includes(tid), "the test switched it on for this business only");

    const tdb = getTenantDbById(tid);
    const { sqlite } = openTenantDb("tenants/voucher-schema-test/voucher-schema-test.db");
    const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ["source", "kind", "voucher_order_id", "message", "colourway", "view_token", "cancelled_at"]) {
      assert.ok(cols("gift_vouchers").includes(c), `gift_vouchers.${c}`);
    }
    for (const c of ["kind", "value_cents", "deliver_to", "deliver_on", "stripe_session_id", "site_url", "delivered_at", "delivery_error", "gift_voucher_id"]) {
      assert.ok(cols("voucher_orders").includes(c), `voucher_orders.${c}`);
    }
    assert.deepEqual(cols("voucher_redemptions"), ["id", "voucher_id", "amount_eur", "appointment_id", "payment_id", "redeemed_by_user_id", "created_at"]);

    const v = { purchaserName: "Sean", valueEur: 50, balanceEur: 50, purchaseDate: "2026-11-23", expiryDate: "2031-11-23" };
    const [a] = tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-AAAA" }).returning().all();
    assert.equal(a!.source, "staff", "an existing or desk-made voucher is a staff one");
    assert.equal(a!.kind, "amount");
    tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-BBBB", viewToken: "tok_1" }).run();
    assert.throws(() => tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-CCCC", viewToken: "tok_1" }).run(), /UNIQUE/, "a gift-page token is never reused");
    tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-DDDD" }).run(); // many without a token is fine
  });

  // Upgrade path: a tenant DB created before this task has the old gift_vouchers
  // table only. Opening it must add the new columns and keep the existing row.
  {
    const legacyFile = path.join(os.tmpdir(), `voucher-upgrade-${process.pid}-${Date.now()}.db`);
    const legacy = new Database(legacyFile);
    try {
      // A bare pre-upgrade file has no clients/therapies tables yet; with FKs on,
      // the insert below would fail trying to check them. The upgraded connection
      // keeps FKs on, as openTenantDb does.
      legacy.pragma("foreign_keys = OFF");
      legacy.exec(`
        CREATE TABLE gift_vouchers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          purchaser_name TEXT NOT NULL,
          purchaser_email TEXT,
          recipient_name TEXT,
          therapy_id INTEGER REFERENCES therapies(id),
          value_eur REAL NOT NULL,
          balance_eur REAL NOT NULL DEFAULT 0,
          is_redeemed INTEGER NOT NULL DEFAULT 0,
          redeemed_by_client_id INTEGER REFERENCES clients(id),
          redeemed_at INTEGER,
          purchase_date TEXT NOT NULL,
          expiry_date TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
      `);
      legacy
        .prepare("INSERT INTO gift_vouchers (code, purchaser_name, value_eur, balance_eur, purchase_date, expiry_date) VALUES ('GC-OLD-0001', 'Old Buyer', 40, 40, '2025-01-01', '2030-01-01')")
        .run();
    } finally {
      legacy.close();
    }

    const upgraded = new Database(legacyFile);
    try {
      ensureTenantTables(upgraded);
      const names = (upgraded.prepare("PRAGMA table_info(gift_vouchers)").all() as Array<{ name: string }>).map((c) => c.name);
      for (const c of ["source", "kind", "voucher_order_id", "message", "colourway", "view_token", "cancelled_at"]) {
        assert.ok(names.includes(c), `upgraded gift_vouchers.${c}`);
      }
      const old = upgraded
        .prepare("SELECT source, kind, view_token FROM gift_vouchers WHERE code = 'GC-OLD-0001'")
        .get() as { source: string; kind: string; view_token: string | null };
      assert.deepEqual(old, { source: "staff", kind: "amount", view_token: null }, "the existing row takes the defaults");

      const ins = upgraded.prepare(
        "INSERT INTO gift_vouchers (code, purchaser_name, value_eur, balance_eur, purchase_date, expiry_date, view_token) VALUES (?, 'T', 10, 10, '2026-01-01', '2031-01-01', ?)",
      );
      ins.run("GC-NEW-0001", "same_token");
      assert.throws(() => ins.run("GC-NEW-0002", "same_token"), /UNIQUE/, "a repeated view_token is refused");
      ins.run("GC-NEW-0003", null);
      ins.run("GC-NEW-0004", null);

      assert.doesNotThrow(() => ensureTenantTables(upgraded), "a second open is harmless");
    } finally {
      upgraded.close();
      fs.rmSync(legacyFile, { force: true });
    }
  }

  console.log("vouchers schema: flag, tables and columns in place");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
