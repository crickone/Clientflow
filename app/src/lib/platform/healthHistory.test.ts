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
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { syncPlatformAlerts } = requireLocal("./healthHistory") as typeof import("./healthHistory");

  const slug = "health-history-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Health History Test", `tenants/${slug}/void.db`) as { id: number };
  const tid = t.id;
  const open = () =>
    controlSqlite.prepare("SELECT key, level, resolved_at, opened_at, last_seen_at FROM platform_alerts WHERE tenant_id = ? ORDER BY key").all(tid) as Array<{ key: string; level: string; resolved_at: number | null; opened_at: number; last_seen_at: number }>;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM platform_alerts WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // 1. a new problem opens one alert.
    let r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "warn", title: "WAL too big" }], 1000);
    assert.deepEqual(r, { opened: 1, resolved: 0, seen: 0 });
    assert.equal(open().length, 1);
    assert.equal(open()[0].opened_at, 1000);

    // 2. the same problem an hour later is the same alert, seen again.
    r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "warn", title: "WAL too big" }], 2000);
    assert.deepEqual(r, { opened: 0, resolved: 0, seen: 1 });
    assert.equal(open().length, 1);
    assert.equal(open()[0].last_seen_at, 2000);

    // 3. when it stops being reported it is resolved, and a new one can open later.
    r = syncPlatformAlerts([], 3000);
    assert.deepEqual(r, { opened: 0, resolved: 1, seen: 0 });
    assert.equal(open()[0].resolved_at, 3000);
    r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "bad", title: "WAL too big" }], 4000);
    assert.deepEqual(r, { opened: 1, resolved: 0, seen: 0 });
    assert.equal(open().length, 2);

    // 4. a sync scoped to one tenant leaves the others alone.
    r = syncPlatformAlerts([], 5000, { tenantIds: [tid + 100000] });
    assert.deepEqual(r, { opened: 0, resolved: 0, seen: 0 });
    assert.equal(open().filter((a) => a.resolved_at === null).length, 1);

    console.log("healthHistory.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
