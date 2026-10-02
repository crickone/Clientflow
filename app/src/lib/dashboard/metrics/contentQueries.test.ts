// Run: npm test -- src/lib/dashboard/metrics/contentQueries.test.ts
//
// Smoke test: every contentQueries loader once against a scratch tenant
// with a little seeded data. Shape plus at least one non-trivial value each.
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
    return { redirect: () => { throw new Error("redirect stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../db/control") as typeof import("../../db/control");
  const { runWithTenant } = requireLocal("../../db/tenant") as typeof import("../../db/tenant");
  const { db, schema } = requireLocal("../../db") as typeof import("../../db");
  const q = requireLocal("./contentQueries") as typeof import("./contentQueries");

  const slug = "dashboard-content-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Content Test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const DAY = 86_400_000;
  const now = Date.now();
  const from = now - 7 * DAY;
  const to = now + DAY;

  try {
    await runWithTenant(t.id, async () => {
      const a = db.insert(schema.carouselSets).values({ name: "Spring post" }).returning().get();
      const b = db.insert(schema.carouselSets).values({ name: "Summer post", generationStatus: "writing", updatedAt: new Date(now - DAY) }).returning().get();
      for (let i = 0; i < 3; i++) {
        db.insert(schema.carouselSlides).values({ carouselSetId: a.id, slideOrder: i, templateId: "t", aspectRatio: "1:1" }).run();
      }
      const SP = schema.scheduledPosts;
      db.insert(SP).values([
        { carouselSetId: a.id, scheduledFor: new Date(now - 2 * DAY), status: "posted", postedAt: new Date(now - 2 * DAY), channels: '["facebook","instagram"]' },
        { carouselSetId: a.id, scheduledFor: new Date(now - 3 * DAY), status: "posted", postedAt: new Date(now - 3 * DAY), channels: '["instagram"]' },
        { carouselSetId: a.id, scheduledFor: new Date(now - 30 * DAY), status: "posted", postedAt: new Date(now - 30 * DAY) },
        { carouselSetId: b.id, scheduledFor: new Date(now + 3 * DAY), status: "scheduled" },
        { carouselSetId: b.id, scheduledFor: new Date(now - DAY), status: "scheduled" },
        { carouselSetId: b.id, scheduledFor: new Date(now - DAY), status: "failed", lastAttemptAt: new Date(now - DAY), error: "No Meta connection" },
        { carouselSetId: b.id, scheduledFor: new Date(now - 40 * DAY), status: "failed", lastAttemptAt: new Date(now - 40 * DAY), error: "old" },
      ]).run();
      const BP = schema.blogPosts;
      db.insert(BP).values([
        { title: "Published recently", inputMode: "prompt", status: "ready", publishState: "published", publishedAt: new Date(now - 2 * DAY), slug: "pub" },
        { title: "Published long ago", inputMode: "prompt", status: "ready", publishState: "published", publishedAt: new Date(now - 90 * DAY), slug: "old" },
        { title: "Blog scheduled", inputMode: "prompt", status: "ready", publishState: "scheduled", scheduledFor: new Date(now + 5 * DAY) },
        { title: "Blog draft", inputMode: "prompt", status: "ready", publishState: "draft" },
        { title: "Still generating", inputMode: "prompt", status: "generating", publishState: "draft" },
      ]).run();
      db.insert(schema.imageLibraryAssets).values([
        { filename: "a.png", originalName: "a.png", mimeType: "image/png", sizeBytes: 1, createdAt: new Date(now - DAY) },
        { filename: "b.png", originalName: "b.png", mimeType: "image/png", sizeBytes: 1, createdAt: new Date(now - 60 * DAY) },
      ]).run();

      assert.equal(q.postedCount(from, to), 2);
      assert.equal(q.scheduledCount(now), 1, "only future scheduled posts");
      assert.equal(q.failedCount(from, to), 1, "failed in range only");
      assert.equal(q.blogPublishedCount(from, to), 1);

      const cal = q.calendarItems(now, 14, 8);
      assert.deepEqual(cal.map((c) => [c.kind, c.name]), [["post", "Summer post"], ["blog", "Blog scheduled"]], "merged by time");

      const cols = q.postedChannelColumns(from, to);
      assert.equal(cols.length, 2);

      const failed = q.failedPosts(8);
      assert.equal(failed.length, 2);
      assert.equal(failed[0].error, "No Meta connection", "newest first");

      const designs = q.recentDesigns(8);
      assert.deepEqual(designs.map((x) => [x.name, x.slides, x.status]), [["Spring post", 3, null], ["Summer post", 0, "writing"]]);

      assert.deepEqual(q.libraryCounts(from, to), { total: 2, added: 1 });
      assert.deepEqual(q.blogPipelineCounts(), { drafts: 1, scheduled: 1, published: 2 });
    });
    console.log("contentQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
