// Run: npm test -- src/lib/billing/addons.test.ts
//
// Paid add-ons + the invoice composition they feed. Covers, against a real
// scratch tenant in the control DB:
//   1. the two DIFFERENT questions — isAddonEnabled (may they USE it: trial
//      or active) vs billableAddons (what do they PAY for: active only) —
//      and that a trial is entitled but charges nothing;
//   2. price freezing: the tenant keeps the price they activated at, across
//      a cancel/re-activate, even if the catalog default changes;
//   3. monthlyLines / monthlySubtotalCents = base plan + active add-ons,
//      which is what the invoice, the card authorisation and the activate
//      page all quote from.
//
// NOTE: plain node:assert/strict via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const {
    ADDON_CATALOG,
    addonsSubtotalCents,
    billableAddons,
    getTenantAddon,
    isAddonActive,
    isAddonEnabled,
    isAddonKey,
    listTenantAddons,
    monthlyLines,
    monthlySubtotalCents,
    setAddonStatus,
  } = requireLocal("./addons") as typeof import("./addons");
  const { getMonthlyPriceCents } = requireLocal("./settings") as typeof import("./settings");

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'addons-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('addons-test','Addons Test','tenants/addons-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenant_addons WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // ── 1. no add-on at all ──
    assert.equal(getTenantAddon(tid, "voice"), null);
    assert.equal(isAddonEnabled(tid, "voice"), false, "no row = not entitled");
    assert.equal(billableAddons(tid).length, 0);
    assert.equal(addonsSubtotalCents(tid), 0);
    assert.equal(isAddonKey("voice"), true);
    assert.equal(isAddonKey("teleport"), false);

    // ── 2. TRIAL: entitled, but charges nothing. This is the whole reason a
    // trial isn't just "active at €0" — the invoice must carry no line. ──
    setAddonStatus(tid, "voice", "trial");
    assert.equal(isAddonEnabled(tid, "voice"), true, "a trial IS entitled to use the feature");
    assert.equal(isAddonActive(tid, "voice"), false, "a trial is NOT an active paid add-on");
    assert.equal(billableAddons(tid).length, 0, "a trial is never invoiced");
    assert.equal(addonsSubtotalCents(tid), 0);
    assert.deepEqual(
      monthlyLines(tid).map((l) => l.kind),
      ["base"],
      "a trialling tenant's invoice is the base plan alone",
    );

    // ── 3. ACTIVE: entitled AND invoiced, at the catalog price ──
    setAddonStatus(tid, "voice", "active");
    assert.equal(isAddonEnabled(tid, "voice"), true);
    assert.equal(isAddonActive(tid, "voice"), true);
    assert.equal(addonsSubtotalCents(tid), ADDON_CATALOG.voice.defaultPriceCents);
    assert.equal(ADDON_CATALOG.voice.defaultPriceCents, 5000, "the Voice Agent add-on is €50/mo");

    const lines = monthlyLines(tid);
    assert.deepEqual(lines.map((l) => l.kind), ["base", "addon"]);
    assert.equal(lines[0].netCents, getMonthlyPriceCents());
    assert.equal(lines[0].addonKey, "", "the base line's addon_key is '' — the column is NOT NULL");
    assert.equal(lines[1].addonKey, "voice");
    assert.equal(
      monthlySubtotalCents(tid),
      getMonthlyPriceCents() + ADDON_CATALOG.voice.defaultPriceCents,
      "a tenant's monthly total is base + active add-ons",
    );

    // ── 4. a negotiated price is FROZEN on the tenant, and survives a
    // cancel/re-activate — an operator pausing someone's voice add-on must
    // not silently re-price them on the way back in. ──
    setAddonStatus(tid, "voice", "active", { priceCents: 3500 });
    assert.equal(getTenantAddon(tid, "voice")!.priceCents, 3500);
    setAddonStatus(tid, "voice", "cancelled");
    assert.equal(isAddonEnabled(tid, "voice"), false, "cancelled = not entitled");
    assert.equal(addonsSubtotalCents(tid), 0, "cancelled = not invoiced");
    assert.ok(getTenantAddon(tid, "voice")!.cancelledAt, "cancellation is timestamped");
    setAddonStatus(tid, "voice", "active");
    assert.equal(getTenantAddon(tid, "voice")!.priceCents, 3500, "the frozen price survived the pause");
    assert.equal(getTenantAddon(tid, "voice")!.cancelledAt, null, "re-activating clears cancelled_at");

    // ── 5. the row is per (tenant, addon) — repeated writes never duplicate ──
    assert.equal(listTenantAddons(tid).length, 1);

    // ── 6. bounds are enforced by the setter itself, not the caller ──
    assert.throws(() => setAddonStatus(tid, "voice", "active", { priceCents: -1 }), /whole number of cents/);
    assert.throws(() => setAddonStatus(tid, "voice", "active", { priceCents: 200_000 }), /whole number of cents/);
    assert.equal(getTenantAddon(tid, "voice")!.priceCents, 3500, "a rejected price left the row untouched");

    console.log("addons.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
