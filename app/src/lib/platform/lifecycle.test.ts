// Run: npm test -- src/lib/platform/lifecycle.test.ts
//
// Platform Console v2, slice 6: the end of a business's life.
//
// The behaviour being protected is the one the operator asked for: a
// cancellation ARCHIVES (reversible, data intact) and a purge happens 30
// days later. Before this, offboarding archived a copy and deleted
// everything in the same call — so the properties worth pinning are:
//
//   - archiving keeps every byte and only closes access;
//   - an archived business cannot be signed into (is_active goes to 0,
//     which the auth layer already refuses) and its sessions end at once;
//   - restoring inside the window puts it back exactly as it was;
//   - nothing is purged before its 30 days are up, and everything is
//     purged after;
//   - a purge writes its backup BEFORE it deletes, and a purge that fails
//     deletes nothing.
//
// A real purge is exercised end to end against a scratch tenant: it is the
// one path where "we think it takes a backup" is not good enough.
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
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in lifecycle.test.ts"); } };
  }
  if (request === "next/headers") {
    return { cookies: () => { throw new Error("no request scope"); }, headers: () => { throw new Error("no request scope"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const lifecycle = requireLocal("./lifecycle") as typeof import("./lifecycle");

  const DAY = 86_400_000;
  const made: number[] = [];
  const mkTenant = (slug: string) => {
    const id = (
      controlSqlite
        .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
        .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }
    ).id;
    made.push(id);
    getTenantDbById(id); // provision the file so a purge has something real to archive
    return id;
  };

  const cleanup = () => {
    for (const id of made) {
      controlSqlite.prepare("DELETE FROM auth_sessions WHERE active_tenant_id = ?").run(id);
      controlSqlite.prepare("DELETE FROM billing_events WHERE tenant_id = ?").run(id);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    }
    for (const slug of ["lifecycle-test", "lifecycle-purge", "lifecycle-due"]) {
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };

  try {
    const tid = mkTenant("lifecycle-test");
    const dbPath = path.join(process.cwd(), "data", "tenants", "lifecycle-test", "lifecycle-test.db");
    assert.ok(fs.existsSync(dbPath), "the scratch tenant has a real database file");

    controlSqlite
      .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES ('lifecycle-s1', 1, ?, ?)")
      .run(tid, Date.now() + DAY);

    // ── a live business ──────────────────────────────────────────────────
    let life = lifecycle.getTenantLifecycle(tid)!;
    assert.equal(life.archivedAt, null);
    assert.equal(life.isActive, true);
    assert.equal(life.purgeAt, null);
    assert.equal(lifecycle.restoreTenant(tid, "test").ok, false, "a live business cannot be restored");

    // ── archive: access stops, data stays ────────────────────────────────
    const archived = lifecycle.archiveTenant(tid, "test", "client cancelled");
    assert.ok(archived.ok, "archiving succeeds");
    assert.match(archived.ok ? archived.note : "", /30 days/, "the note says when the data goes");

    life = lifecycle.getTenantLifecycle(tid)!;
    assert.ok(life.archivedAt, "archived_at is set");
    assert.equal(life.isActive, false, "the business is inactive, which is what the auth layer refuses");
    assert.equal(life.daysLeft, lifecycle.PURGE_AFTER_DAYS, "the full window is left");
    assert.ok(fs.existsSync(dbPath), "EVERY BYTE IS STILL THERE — archiving deletes nothing");
    assert.equal(
      (controlSqlite.prepare("SELECT count(*) AS n FROM auth_sessions WHERE active_tenant_id = ?").get(tid) as { n: number }).n,
      0,
      "their sessions ended immediately, rather than being left to expire",
    );
    assert.equal(lifecycle.archiveTenant(tid, "test", "again").ok, false, "archiving twice is refused");

    // ── restore: back exactly as it was ──────────────────────────────────
    const restored = lifecycle.restoreTenant(tid, "test");
    assert.ok(restored.ok, "restoring succeeds");
    life = lifecycle.getTenantLifecycle(tid)!;
    assert.equal(life.archivedAt, null);
    assert.equal(life.isActive, true, "they can sign in again");
    assert.ok(fs.existsSync(dbPath));

    // ── the window: nothing goes early, everything goes late ─────────────
    lifecycle.archiveTenant(tid, "test", "cancelled again");
    const now = Date.now();
    assert.equal(lifecycle.listDueForPurge(now).length, 0, "a business archived today is not due");
    assert.equal(
      lifecycle.listDueForPurge(now + (lifecycle.PURGE_AFTER_DAYS - 1) * DAY).length,
      0,
      "…nor on day 29",
    );
    const due = lifecycle.listDueForPurge(now + (lifecycle.PURGE_AFTER_DAYS + 1) * DAY);
    assert.ok(due.some((t) => t.tenantId === tid), "…and is due once the window has passed");
    lifecycle.restoreTenant(tid, "test");
    assert.equal(
      lifecycle.listDueForPurge(now + 90 * DAY).some((t) => t.tenantId === tid),
      false,
      "a restored business is never due again",
    );

    // ── a real purge: backup first, then gone ────────────────────────────
    const purgeTid = mkTenant("lifecycle-purge");
    const purgePath = path.join(process.cwd(), "data", "tenants", "lifecycle-purge", "lifecycle-purge.db");
    assert.ok(fs.existsSync(purgePath));
    const archiveRoot = path.join(process.cwd(), "data", "archive");
    const before = new Set(fs.existsSync(archiveRoot) ? fs.readdirSync(archiveRoot) : []);

    const purged = lifecycle.purgeTenant(purgeTid, "test");
    assert.ok(purged.ok, `purging succeeds: ${purged.ok ? "" : purged.error}`);
    assert.equal(lifecycle.getTenantLifecycle(purgeTid), null, "the business is gone from the registry");
    assert.equal(fs.existsSync(purgePath), false, "its live database is gone");

    const after = fs.readdirSync(archiveRoot).filter((n) => !before.has(n) && n.startsWith("lifecycle-purge-"));
    assert.equal(after.length, 1, "a backup directory was written");
    const dir = path.join(archiveRoot, after[0]);
    assert.ok(fs.existsSync(path.join(dir, "lifecycle-purge.db")), "THE BACKUP HAS THE DATABASE IN IT");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { slug: string };
    assert.equal(manifest.slug, "lifecycle-purge", "…and a manifest naming the business");
    fs.rmSync(dir, { recursive: true, force: true });

    assert.equal(lifecycle.purgeTenant(purgeTid, "test").ok, false, "purging what is already gone is refused");
    assert.equal(lifecycle.purgeTenant(999_999_9, "test").ok, false, "purging an unknown business is refused");

    // ── the daily pass only takes what is due ────────────────────────────
    const dueTid = mkTenant("lifecycle-due");
    controlSqlite
      .prepare("UPDATE tenants SET archived_at = ?, is_active = 0 WHERE id = ?")
      .run(Date.now() - (lifecycle.PURGE_AFTER_DAYS + 2) * DAY, dueTid);
    lifecycle.archiveTenant(tid, "test", "kept inside the window");

    const result = lifecycle.runDuePurges();
    assert.ok(result.purged >= 1, "the overdue business was purged");
    assert.equal(result.failed, 0);
    assert.equal(lifecycle.getTenantLifecycle(dueTid), null, "…and is gone");
    assert.ok(lifecycle.getTenantLifecycle(tid), "the one inside its window is untouched");
    for (const n of fs.readdirSync(archiveRoot).filter((n) => n.startsWith("lifecycle-due-"))) {
      fs.rmSync(path.join(archiveRoot, n), { recursive: true, force: true });
    }

    console.log("lifecycle.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
