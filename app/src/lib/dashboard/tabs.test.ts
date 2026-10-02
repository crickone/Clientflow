// Run: npm test -- src/lib/dashboard/tabs.test.ts
//
// Tab storage against a real scratch tenant DB. The properties:
//   1. resolution order: own rows > team default rows > platform Overview;
//   2. resolveTabs never writes (viewing is free);
//   3. the first edit copies the resolved set into the user's own rows;
//   4. add (preset/blank/duplicate), rename, move, delete (never the last),
//      range, reset, and the tab cap;
//   5. makeTeamDefault replaces the team set; other users then start from it.
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
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tabs.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { schema } = requireLocal("../db") as typeof import("../db");
  const tabs = requireLocal("./tabs") as typeof import("./tabs");
  const { MAX_TABS_PER_USER } = requireLocal("./catalog") as typeof import("./catalog");

  const slug = "dashboard-tabs-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Tabs Test", dbFile) as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };
  const rowCount = () => getTenantDbById(tid).select().from(schema.dashboards).all().length;
  const ALICE = 101;
  const BOB = 102;

  try {
    runWithTenant(tid, () => {
      // 1 + 2: platform default, and viewing does not write.
      const first = tabs.resolveTabs(ALICE, "clinic");
      assert.equal(first.source, "platform");
      assert.equal(first.tabs.length, 1);
      assert.equal(first.tabs[0].name, "Overview");
      assert.equal(first.tabs[0].presetKey, "overview");
      assert.equal(first.tabs[0].widgets[0].key, "overview.todaysBookings");
      assert.equal(rowCount(), 0, "resolveTabs never writes");

      // 3: first edit materialises the user's own rows.
      tabs.saveTabWidgets(ALICE, "clinic", 0, [{ key: "overview.newLeads", size: "M" }]);
      const own = tabs.resolveTabs(ALICE, "clinic");
      assert.equal(own.source, "own");
      assert.deepEqual(own.tabs[0].widgets, [{ key: "overview.newLeads", size: "M" }]);
      assert.throws(() => tabs.saveTabWidgets(ALICE, "clinic", 0, [{ key: "x.y", size: "S" }]), /Unknown widget/);

      // 4: add, rename, move, range, delete, reset.
      const blank = tabs.addTab(ALICE, "clinic", { kind: "blank" });
      assert.equal(blank, 1);
      tabs.renameTab(ALICE, "clinic", 1, "  Mine  ");
      const dup = tabs.addTab(ALICE, "clinic", { kind: "duplicate", index: 0 });
      assert.equal(dup, 2);
      let names = tabs.resolveTabs(ALICE, "clinic").tabs.map((x) => x.name);
      assert.deepEqual(names, ["Overview", "Mine", "Overview copy"]);
      tabs.moveTab(ALICE, "clinic", 2, 0);
      names = tabs.resolveTabs(ALICE, "clinic").tabs.map((x) => x.name);
      assert.deepEqual(names, ["Overview copy", "Overview", "Mine"]);
      tabs.setTabRange(ALICE, "clinic", 0, "90d");
      assert.equal(tabs.resolveTabs(ALICE, "clinic").tabs[0].range, "90d");
      assert.throws(() => tabs.setTabRange(ALICE, "clinic", 0, "custom"), /range/);
      tabs.deleteTab(ALICE, "clinic", 2);
      tabs.deleteTab(ALICE, "clinic", 1);
      assert.throws(() => tabs.deleteTab(ALICE, "clinic", 0), /last tab/);
      tabs.resetTab(ALICE, "clinic", 0);
      assert.equal(tabs.resolveTabs(ALICE, "clinic").tabs[0].widgets.length, 14, "reset restores the Overview preset");
      assert.throws(() => tabs.renameTab(ALICE, "clinic", 0, "   "), /name/);
      assert.throws(() => tabs.addTab(ALICE, "clinic", { kind: "preset", presetKey: "nope" }), /preset/);

      // cap
      for (let i = tabs.resolveTabs(ALICE, "clinic").tabs.length; i < MAX_TABS_PER_USER; i++) {
        tabs.addTab(ALICE, "clinic", { kind: "blank" });
      }
      assert.throws(() => tabs.addTab(ALICE, "clinic", { kind: "blank" }), /at most/);

      // 5: team default.
      while (tabs.resolveTabs(ALICE, "clinic").tabs.length > 2) tabs.deleteTab(ALICE, "clinic", 2);
      tabs.makeTeamDefault(ALICE, "clinic");
      const bob = tabs.resolveTabs(BOB, "clinic");
      assert.equal(bob.source, "team");
      assert.equal(bob.tabs.length, 2);
      tabs.renameTab(BOB, "clinic", 1, "Bob's");
      assert.equal(tabs.resolveTabs(BOB, "clinic").source, "own");
      assert.equal(tabs.resolveTabs(ALICE, "clinic").tabs[1].name !== "Bob's", true, "Bob's edit is his own");
      tabs.clearTeamDefault();
      assert.equal(tabs.resolveTabs(9999, "clinic").source, "platform");
    });
    console.log("tabs.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
