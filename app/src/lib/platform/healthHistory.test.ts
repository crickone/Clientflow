// Run: npm test -- src/lib/platform/healthHistory.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
import { rmSync } from "node:fs";
import path from "node:path";
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { syncPlatformAlerts, snapshotFleetHealth, listHealthHistory, planFleetSync } = requireLocal("./healthHistory") as typeof import("./healthHistory");

  const slug = "health-history-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Health History Test", `tenants/${slug}/void.db`) as { id: number };
  const tid = t.id;
  const open = () =>
    controlSqlite.prepare("SELECT key, level, resolved_at, opened_at, last_seen_at FROM platform_alerts WHERE tenant_id = ? ORDER BY key").all(tid) as Array<{ key: string; level: string; resolved_at: number | null; opened_at: number; last_seen_at: number }>;
  const dbDir = path.join(process.cwd(), "data", "tenants", slug);
  const cleanup = () => {
    rmSync(dbDir, { recursive: true, force: true });
    controlSqlite.prepare("DELETE FROM platform_alerts WHERE tenant_id = ?").run(tid);
    // snapshotFleetHealth also writes rows for every other local tenant at the fake instants.
    controlSqlite.prepare("DELETE FROM health_snapshots WHERE at IN (10000, 20000, 30000)").run();
    controlSqlite.prepare("DELETE FROM platform_alerts WHERE opened_at IN (10000, 20000, 30000)").run();
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  const cleanup2 = () => { controlSqlite.prepare("DELETE FROM platform_alerts WHERE tenant_id = ?").run(tid); };
  try {
    // 1. a new problem opens one alert.
    let r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "warn", title: "WAL too big" }], 1000, { tenantIds: [tid] });
    assert.deepEqual(r, { opened: 1, resolved: 0, seen: 0 });
    assert.equal(open().length, 1);
    assert.equal(open()[0].opened_at, 1000);

    // 2. the same problem an hour later is the same alert, seen again.
    r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "warn", title: "WAL too big" }], 2000, { tenantIds: [tid] });
    assert.deepEqual(r, { opened: 0, resolved: 0, seen: 1 });
    assert.equal(open().length, 1);
    assert.equal(open()[0].last_seen_at, 2000);

    // 3. when it stops being reported it is resolved, and a new one can open later.
    r = syncPlatformAlerts([], 3000, { tenantIds: [tid] });
    assert.deepEqual(r, { opened: 0, resolved: 1, seen: 0 });
    assert.equal(open()[0].resolved_at, 3000);
    r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "bad", title: "WAL too big" }], 4000, { tenantIds: [tid] });
    assert.deepEqual(r, { opened: 1, resolved: 0, seen: 0 });
    assert.equal(open().length, 2);

    // 4. a sync scoped to one tenant leaves the others alone.
    r = syncPlatformAlerts([], 5000, { tenantIds: [tid + 100000] });
    assert.deepEqual(r, { opened: 0, resolved: 0, seen: 0 });
    assert.equal(open().filter((a) => a.resolved_at === null).length, 1);

    // 5. duplicate candidates never break the hour.
    cleanup2();
    r = syncPlatformAlerts([
      { tenantId: tid, key: "dup", level: "warn", title: "a" },
      { tenantId: tid, key: "dup", level: "warn", title: "b" },
    ], 6000, { tenantIds: [tid] });
    assert.equal(r.opened, 1);

    // 6. snapshot on a business whose database file is missing: alert raised, no crash, a row written.
    cleanup2();
    // Reading a business opens (and so creates) its database, so start from no file.
    rmSync(dbDir, { recursive: true, force: true });
    const snap = snapshotFleetHealth(10_000);
    assert.ok(snap.tenants >= 1);
    assert.ok(open().some((a) => a.key === "health:db_missing" && a.resolved_at === null), "db_missing alert opened");
    const hist = listHealthHistory(tid, 0);
    assert.equal(hist.length, 1);
    assert.equal(hist[0].at, 10_000);
    assert.ok(hist[0].alertsBad >= 1);

    // 7. listHealthHistory: time order, since an instant.
    snapshotFleetHealth(30_000);
    snapshotFleetHealth(20_000);
    assert.deepEqual(listHealthHistory(tid, 0).map((x) => x.at), [10_000, 20_000, 30_000]);
    assert.deepEqual(listHealthHistory(tid, 20_000).map((x) => x.at), [20_000, 30_000]);

    // 8. a failed health read never resolves that business's other open alerts.
    cleanup2();
    type Fleet = Parameters<typeof planFleetSync>[0];
    const mk = (readable: boolean, alerts: Array<{ key: string; level: "bad" | "warn"; message: string }>): Fleet => ({
      tenants: [{ tenantId: tid, name: "x", slug, dbBytes: 0, walBytes: 0, queueDue: 0, queueFailed: 0, stuck: 0, readable, alerts }],
      schedulers: [], duplicateSiteSlugs: [],
    } as unknown as Fleet);
    const sync = (f: Fleet, at: number) => { const p = planFleetSync(f); return syncPlatformAlerts(p.candidates, at, { tenantIds: p.tenantIds }); };
    const isOpen = (key: string) => open().some((a) => a.key === key && a.resolved_at === null);
    sync(mk(true, [{ key: "wal", level: "warn", message: "wal big" }]), 40_000);
    assert.ok(isOpen("health:wal"), "wal opened");
    sync(mk(false, [{ key: "unreadable", level: "bad", message: "boom" }]), 50_000);
    assert.ok(isOpen("health:wal"), "wal stays open through a failed read");
    assert.ok(isOpen("health:unreadable"), "unreadable open");
    sync(mk(true, []), 60_000);
    assert.ok(!isOpen("health:wal"), "wal resolved once readable and clear");
    assert.ok(!isOpen("health:unreadable"), "unreadable resolved on recovery");

    // 9. act on an alert.
    cleanup2();
    syncPlatformAlerts([{ tenantId: tid, key: "act", level: "warn", title: "act" }], 1000, { tenantIds: [tid] });
    const { alertAction, listOpenAlerts } = requireLocal("./healthHistory") as typeof import("./healthHistory");
    const openOne = listOpenAlerts({ tenantId: tid })[0];
    assert.ok(openOne);
    assert.deepEqual(alertAction(openOne.id, { op: "snooze", until: 9000 }, 1, 5000), { ok: true });
    assert.equal(listOpenAlerts({ tenantId: tid, now: 6000 }).length, 0, "snoozed is hidden");
    assert.equal(listOpenAlerts({ tenantId: tid, now: 9001 }).length, 1, "and back when the snooze ends");
    assert.deepEqual(alertAction(openOne.id, { op: "ack" }, 1, 7000), { ok: true });
    assert.equal(listOpenAlerts({ tenantId: tid, now: 9001 })[0].acknowledgedBy, 1);
    assert.equal(alertAction(999999999, { op: "ack" }, 1).ok, false);

    console.log("healthHistory.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
