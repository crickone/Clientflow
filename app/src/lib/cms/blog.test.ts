// Run: npm test -- src/lib/cms/blog.test.ts
//
// Batch 4b (blog scheduled-publish, improvement-plan-2026-08.md Theme D2):
// publishState "scheduled" + scheduledFor existed in the schema, but nothing
// ever SET a scheduled post (no UI control) and nothing ever PUBLISHED a due
// one (no worker). This file verifies both new pieces plus the shared state
// machine underneath them:
//   1. parseScheduledFor — the pure validator schedulePostAction uses to
//      reject a past/invalid datetime before ever touching the DB.
//   2. publishDueScheduledPosts(tenantDb, nowMs) — the tenant-explicit daily
//      worker: a past-due scheduled post flips to published, a future one is
//      left alone, a draft/already-published one is untouched — and
//      re-running is idempotent (nothing left to do, nothing re-stamped).
//   3. setPublishState's scheduling round-trip (schedule -> "Publish now" /
//      "Cancel schedule") — the same function schedulePostAction and the
//      existing Publish/Unpublish actions all share, so this pins that a
//      change to one transition can't silently break the others.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// ./blog -> @/lib/db (the ambient `db` proxy) -> @/lib/db/tenant (react
// `cache`) and -> @/lib/tenants -> @/lib/auth -> next/navigation. Same
// two-part shim as src/lib/agents/tools.marketing.test.ts, for the same
// reason: under the runner's `--conditions=react-server`, npm's react
// "react-server" entry throws on load, so `cache` needs stubbing; and
// next/navigation's real module drags in Next's client-router internals we
// have no reason to load here (redirect() is never actually exercised by
// this test's code path). Installed via a dynamic require (below) rather
// than a static import, since a static `import ... from "./blog"` would be
// hoisted and evaluated before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in blog.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// A clearly-synthetic fixture "now" (year 2030) rather than the real current
// date, so the past/future scheduling math below is obviously correct no
// matter when this test happens to run.
const NOW_MS = new Date("2030-01-15T12:00:00.000Z").getTime();
const PAST = new Date(NOW_MS - 60 * 60_000); // 1h before "now" -> due
const FUTURE = new Date(NOW_MS + 60 * 60_000); // 1h after "now" -> not due yet
const LONG_AGO_PUBLISHED_AT = new Date(NOW_MS - 30 * 24 * 60 * 60_000); // 30 days before "now"

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as the other tests here).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { sites, blogPosts } = requireLocal("../db/schema") as typeof import("../db/schema");
  const { parseScheduledFor, publishDueScheduledPosts, setPublishState } =
    requireLocal("./blog") as typeof import("./blog");

  // ── scratch tenant (control row + a real tenant DB file) ──
  const slug = "cms-blog-schedule-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "CMS Blog Schedule Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    // ── 1. parseScheduledFor — pure, no DB involved ──
    assert.throws(
      () => parseScheduledFor("not-a-date", new Date(NOW_MS)),
      /valid date/i,
      "an unparseable string is rejected",
    );
    assert.throws(
      () => parseScheduledFor(PAST.toISOString(), new Date(NOW_MS)),
      /future/i,
      "a past datetime is rejected",
    );
    assert.throws(
      () => parseScheduledFor(new Date(NOW_MS).toISOString(), new Date(NOW_MS)),
      /future/i,
      "the exact current instant is rejected — must be strictly in the future",
    );
    const parsed = parseScheduledFor(FUTURE.toISOString(), new Date(NOW_MS));
    assert.equal(parsed.getTime(), FUTURE.getTime(), "a valid future datetime round-trips exactly");

    // ── scratch tenant DB + site, for the worker + setPublishState checks ──
    const tdb = getTenantDbById(tid);
    const site = tdb.insert(sites).values({ slug: "schedule-site", name: "Schedule Site" }).returning().get();

    const mkPost = (title: string, extra: Partial<typeof blogPosts.$inferInsert>) =>
      tdb
        .insert(blogPosts)
        .values({ siteId: site.id, title, inputMode: "prompt", publishState: "draft", ...extra })
        .returning()
        .get();

    function reread(id: number) {
      const row = tdb.select().from(blogPosts).where(eq(blogPosts.id, id)).get();
      if (!row) throw new Error(`post ${id} not found`);
      return row;
    }

    const scheduledPast = mkPost("Due now", { publishState: "scheduled", scheduledFor: PAST });
    const scheduledFuture = mkPost("Not due yet", { publishState: "scheduled", scheduledFor: FUTURE });
    const draftPost = mkPost("Still a draft", {});
    const alreadyPublished = mkPost("Already live", {
      publishState: "published",
      publishedAt: LONG_AGO_PUBLISHED_AT,
    });

    // ── 2. publishDueScheduledPosts: the worker's core behaviour ──
    const publishedCount = publishDueScheduledPosts(tdb, NOW_MS);
    assert.equal(publishedCount, 1, "exactly the one past-due scheduled post is published");

    const pastRow = reread(scheduledPast.id);
    assert.equal(pastRow.publishState, "published", "a past scheduledFor flips to published");
    assert.equal(pastRow.publishedAt?.getTime(), NOW_MS, "publishedAt is stamped with the worker's `now`");
    assert.equal(pastRow.scheduledFor, null, "scheduledFor is cleared once published");

    const futureRow = reread(scheduledFuture.id);
    assert.equal(futureRow.publishState, "scheduled", "a future scheduledFor is left alone");
    assert.equal(futureRow.scheduledFor?.getTime(), FUTURE.getTime(), "the future post's scheduledFor is untouched");

    const draftRow = reread(draftPost.id);
    assert.equal(draftRow.publishState, "draft", "a plain draft is untouched by the worker");
    assert.equal(draftRow.publishedAt, null, "a draft is not accidentally published");

    const publishedRow = reread(alreadyPublished.id);
    assert.equal(publishedRow.publishState, "published", "an already-published post stays published");
    assert.equal(
      publishedRow.publishedAt?.getTime(),
      LONG_AGO_PUBLISHED_AT.getTime(),
      "an already-published post's original publishedAt is NOT overwritten — it was never re-processed",
    );

    // ── Idempotency: re-running at the exact same `now` finds nothing left ──
    const secondRun = publishDueScheduledPosts(tdb, NOW_MS);
    assert.equal(secondRun, 0, "re-running immediately publishes nothing further");
    assert.equal(
      reread(scheduledPast.id).publishedAt?.getTime(),
      NOW_MS,
      "the first run's publishedAt is unchanged by the second run (not re-stamped)",
    );

    // ── The future post eventually becomes due on a later tick ──
    const laterMs = FUTURE.getTime() + 1000;
    const thirdRun = publishDueScheduledPosts(tdb, laterMs);
    assert.equal(thirdRun, 1, "the previously-future post is published once its time arrives");
    assert.equal(reread(scheduledFuture.id).publishState, "published");

    // ── 3. setPublishState's scheduling round-trip — the function
    // schedulePostAction (and the existing Publish/Unpublish actions) all
    // share. runWithTenant reproduces the ambient-tenant contract a real
    // request would have (same pattern as tools.marketing.test.ts). ──
    const roundTrip = mkPost("Round trip", {});
    const futureSchedule = new Date(NOW_MS + 2 * 60 * 60_000);
    runWithTenant(tid, () => setPublishState(site.id, roundTrip.id, "scheduled", futureSchedule));
    let rtRow = reread(roundTrip.id);
    assert.equal(rtRow.publishState, "scheduled", "setPublishState('scheduled', …) sets the state");
    assert.equal(rtRow.scheduledFor?.getTime(), futureSchedule.getTime(), "…and stores the exact scheduledFor");
    assert.equal(rtRow.publishedAt, null, "a merely-scheduled post has no publishedAt yet");

    // "Publish now" while scheduled (the editor's Publish button) — publishes
    // immediately and clears the schedule.
    runWithTenant(tid, () => setPublishState(site.id, roundTrip.id, "published"));
    rtRow = reread(roundTrip.id);
    assert.equal(rtRow.publishState, "published", "publishing while scheduled flips straight to published");
    assert.equal(rtRow.scheduledFor, null, "publishing clears the now-irrelevant schedule");
    assert.ok(rtRow.publishedAt, "publishedAt is stamped");

    // "Cancel schedule" (the editor's Unpublish button, shown while
    // scheduled) — reverts to draft and clears the schedule; must NOT publish.
    const cancelled = mkPost("Cancel me", {});
    runWithTenant(tid, () => setPublishState(site.id, cancelled.id, "scheduled", futureSchedule));
    runWithTenant(tid, () => setPublishState(site.id, cancelled.id, "draft"));
    const cancelledRow = reread(cancelled.id);
    assert.equal(cancelledRow.publishState, "draft", "cancelling a schedule reverts to draft, not published");
    assert.equal(cancelledRow.scheduledFor, null, "cancelling clears the schedule");
    assert.equal(cancelledRow.publishedAt, null, "cancelling a schedule never stamps publishedAt");

    console.log("cms/blog.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
