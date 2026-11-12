// Run: npm test -- src/lib/platform/views.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { isSafeConsolePath, listViews, saveViews } = requireLocal("./views") as typeof import("./views");

  // isSafeConsolePath
  assert.equal(isSafeConsolePath("/gyms?status=past_due"), true);
  assert.equal(isSafeConsolePath("/audit?ok=0"), true);
  assert.equal(isSafeConsolePath("//evil.com"), false, "protocol-relative is external");
  assert.equal(isSafeConsolePath("/\\evil.com"), false, "backslash variant is external in browsers");
  assert.equal(isSafeConsolePath("https://x"), false);
  assert.equal(isSafeConsolePath("gyms"), false, "must start with a slash");
  assert.equal(isSafeConsolePath("/a\u0000b"), false, "control characters refused");
  assert.equal(isSafeConsolePath("/" + "a".repeat(500)), false, "over 500 chars refused");
  assert.equal(isSafeConsolePath("/" + "a".repeat(499)), true, "499 chars accepted");

  // saveViews / listViews round-trip on a scratch user
  const userId = 999999;
  const key = `console_views:${userId}`;
  const cleanup = () => controlSqlite.prepare("DELETE FROM platform_settings WHERE key = ?").run(key);
  cleanup();
  try {
    const first = saveViews(userId, [
      { id: "a", name: "Past due", href: "/gyms?status=past_due" },
      { id: "b", name: "Bad", href: "//evil.com/x" },
      { id: "c", name: "Audit", href: "/audit?ok=0" },
      { id: "d", name: "Dupe", href: "/gyms?status=past_due" },
      { id: "e", name: "Blank", href: "/health" }, // blank name below
    ].map((v, i) => (i === 4 ? { ...v, name: "   " } : v)));
    assert.deepEqual(first, { ok: true });

    const listed = listViews(userId);
    assert.deepEqual(
      listed.map((v) => v.href),
      ["/gyms?status=past_due", "/audit?ok=0"],
      "unsafe and duplicate hrefs dropped, order kept",
    );
    assert.deepEqual(listed[0], { id: "a", name: "Past due", href: "/gyms?status=past_due" });

    // Unsafe stored rows are filtered out on read too.
    controlSqlite
      .prepare("INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify([{ id: "x", name: "Ext", href: "/\\evil.com" }, { id: "y", name: "Ok", href: "/clients" }]));
    assert.deepEqual(listViews(userId).map((v) => v.href), ["/clients"]);

    // 31 views is refused, nothing written.
    const thirtyOne = Array.from({ length: 31 }, (_, i) => ({ id: `v${i}`, name: `View ${i}`, href: `/p${i}` }));
    const refused = saveViews(userId, thirtyOne);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.error, "You have 30 saved views. Remove one first.");
    assert.deepEqual(listViews(userId).map((v) => v.href), ["/clients"], "refusal leaves stored list untouched");

    // Exactly 30 is accepted.
    const thirty = thirtyOne.slice(0, 30);
    assert.deepEqual(saveViews(userId, thirty), { ok: true });
    assert.equal(listViews(userId).length, 30);

    // Duplicate hrefs are dropped, first one wins.
    assert.deepEqual(saveViews(userId, [
      { id: "1", name: "First", href: "/x" },
      { id: "2", name: "Second", href: "/x" },
    ]), { ok: true });
    assert.deepEqual(listViews(userId), [{ id: "1", name: "First", href: "/x" }]);
  } finally {
    cleanup();
  }
  console.log("views.test.ts: all assertions passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
