// Run: npm test -- src/lib/cms/pageRevisions.test.ts
//
// A page used to have exactly one body. Any write — a publish from the
// editor, an image swapped by the assistant, a deploy — replaced it with no
// way back, and that is the only reason the deploy sync had to lock a whole
// page the moment a person touched it. An overwrite could not be undone, so
// it had to be prevented.
//
// These are the properties that make it undoable:
//   - a snapshot holds what is about to be LOST, not what replaces it;
//   - the very first one is the pre-history state, so the first edit after
//     this shipped is recoverable too;
//   - a restore is itself snapshotted, or "restore" becomes a new way to
//     lose work;
//   - history cannot grow without limit.
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
  if (request === "next/navigation") return { redirect: () => { throw new Error("stub"); } };
  if (request === "next/headers") {
    return { headers: () => { throw new Error("no request"); }, cookies: () => { throw new Error("no request"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant, openTenantDb } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const rev = requireLocal("./pageRevisions") as typeof import("./pageRevisions");
  const { setDraftContent, publishDraft } = requireLocal("./pageDraft") as typeof import("./pageDraft");

  const slug = "page-revisions-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "Revisions Test", `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    getTenantDbById(tid);
    const { sqlite } = openTenantDb(`tenants/${slug}/${slug}.db`);
    sqlite.prepare("INSERT INTO sites (slug, name, status) VALUES ('rv', 'Revisions', 'live')").run();
    const sid = (sqlite.prepare("SELECT id FROM sites WHERE slug='rv'").get() as { id: number }).id;
    sqlite
      .prepare(
        "INSERT INTO pages (site_id,page_key,path,title,template_id,status,created_at,updated_at) VALUES (?,?,?,?,'clientflow-live','published',?,?)",
      )
      .run(sid, "index", "/", "Home", Date.now(), Date.now());
    const pid = (sqlite.prepare("SELECT id FROM pages WHERE site_id=? AND path='/'").get(sid) as { id: number }).id;

    const HEAD = "<style>.a{}</style>";
    const TAIL = "<script>1</script>";
    const bodyWith = (content: string) => HEAD + content + TAIL;

    sqlite
      .prepare(
        "INSERT INTO content_blocks (site_id,page_id,name,kind,value,created_at,updated_at) VALUES (?,?,'body','html',?,?,?)",
      )
      .run(sid, pid, bodyWith("<p>the original page, long enough to pass the publish gate</p>"), Date.now(), Date.now());

    const liveBody = () =>
      (
        sqlite
          .prepare("SELECT value v FROM content_blocks WHERE site_id=? AND page_id=? AND name='body'")
          .get(sid, pid) as { v: string }
      ).v;

    await runWithTenant(tid, async () => {
      assert.deepEqual(rev.listRevisions(sid, pid), [], "a page starts with no history");

      // ── publishing keeps what it replaced ─────────────────────────────
      setDraftContent(sid, pid, "<p>the SECOND version, also long enough to pass the gate</p>");
      const first = publishDraft(sid, pid, 42);
      assert.ok(first.ok, "the edit publishes");

      let history = rev.listRevisions(sid, pid);
      assert.equal(history.length, 1, "publishing recorded one version");
      assert.match(
        history[0].body,
        /the original page/,
        "THE SNAPSHOT HOLDS WHAT WAS LOST, not what replaced it",
      );
      assert.equal(
        history[0].source,
        "baseline",
        "the first one is the pre-history state, so even the first edit is recoverable",
      );
      assert.match(liveBody(), /SECOND version/, "and the page itself moved on");

      // ── a second edit records the first ───────────────────────────────
      setDraftContent(sid, pid, "<p>a THIRD version, still long enough to pass the gate</p>");
      assert.ok(publishDraft(sid, pid, 42).ok);
      history = rev.listRevisions(sid, pid);
      assert.equal(history.length, 2, "a second edit adds a second version");
      assert.match(history[0].body, /SECOND version/, "newest first");
      assert.equal(history[0].source, "studio", "…and it is attributed to the editor");
      assert.equal(history[0].createdBy, 42, "…and to the person");

      // ── restoring ─────────────────────────────────────────────────────
      const wanted = history.find((h) => /the original page/.test(h.body))!;
      const out = rev.restoreRevision(sid, pid, wanted.id, 7);
      assert.ok(out.ok, "the restore succeeds");
      assert.match(liveBody(), /the original page/, "THE PAGE IS BACK to the version chosen");

      // A restore is a change like any other, so it too can be undone.
      history = rev.listRevisions(sid, pid);
      assert.equal(history[0].source, "restore", "the restore recorded what it replaced");
      assert.match(history[0].body, /THIRD version/, "…which was the version live at the time");
      assert.match(history[0].note ?? "", /restore/i, "…and says so");

      const backAgain = rev.restoreRevision(sid, pid, history[0].id, 7);
      assert.ok(backAgain.ok, "…so a restore can itself be undone");
      assert.match(liveBody(), /THIRD version/, "and we are back where we were");

      // Restoring stamps the page, so a deploy will not quietly replace a
      // version somebody deliberately chose.
      const stamp = sqlite
        .prepare("SELECT updated_by u FROM content_blocks WHERE site_id=? AND page_id=? AND name='body'")
        .get(sid, pid) as { u: number | null };
      assert.equal(stamp.u, 7, "a restored page is marked as a person's decision");

      assert.equal(
        rev.restoreRevision(sid, pid, 999_999, 7).ok,
        false,
        "restoring a version that does not exist fails cleanly",
      );

      // ── history cannot grow forever ───────────────────────────────────
      // A body runs to tens of kilobytes; unbounded history would grow by
      // that much per edit, per page, per tenant, permanently.
      for (let i = 0; i < rev.MAX_REVISIONS_PER_PAGE + 12; i++) {
        setDraftContent(sid, pid, `<p>version number ${i}, padded out so the publish gate is happy</p>`);
        publishDraft(sid, pid, 42);
      }
      const capped = rev.listRevisions(sid, pid, 500);
      assert.equal(capped.length, rev.MAX_REVISIONS_PER_PAGE, "history is capped");
      assert.match(capped[0].body, /version number/, "…keeping the NEWEST");
      assert.ok(
        !capped.some((r) => /the original page/.test(r.body)),
        "…and dropping the oldest, which is the only sane thing to discard",
      );
    });

    console.log("pageRevisions.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
