// Run: npm test -- src/lib/platform/flags.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { listPlatformFlags, setPlatformFlag, rolloutCount } = requireLocal("./flags") as typeof import("./flags");
  const { MODULE_CATALOG } = requireLocal("../features") as typeof import("../features");

  const key = "leads";
  const saved = controlSqlite.prepare("SELECT * FROM platform_flags WHERE key = ?").get(key) as Record<string, unknown> | undefined;
  try {
    controlSqlite.prepare("DELETE FROM platform_flags WHERE key = ?").run(key);
    const fresh = listPlatformFlags();
    assert.equal(fresh.length, MODULE_CATALOG.length);
    assert.ok(fresh.every((f) => f.mode === "all" && f.percent === 100 && f.allow.length === 0), "default all");

    setPlatformFlag({ key, mode: "allow", percent: 150, allow: [3, 9] });
    const f = listPlatformFlags().find((x) => x.key === key)!;
    assert.deepEqual(f, { key, mode: "allow", percent: 100, allow: [3, 9] });
    assert.equal(rolloutCount(f, [1, 3, 9, 12]), 2);

    setPlatformFlag({ key, mode: "none", percent: 0, allow: [] });
    assert.equal(listPlatformFlags().find((x) => x.key === key)!.mode, "none");
    console.log("platform flags: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM platform_flags WHERE key = ?").run(key);
    if (saved) {
      controlSqlite
        .prepare("INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES (?,?,?,?,?)")
        .run(saved.key, saved.mode, saved.percent, saved.allow, saved.updated_at);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
