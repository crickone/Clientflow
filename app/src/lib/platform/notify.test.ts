// Run: npm test -- src/lib/platform/notify.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { shouldNotifyInstant, digestHtml, sendInstantAlerts, sendDailyDigest } = requireLocal("./notify") as typeof import("./notify");
const { controlSqlite } = requireLocal("@/lib/db/control") as typeof import("@/lib/db/control");

assert.equal(shouldNotifyInstant({ level: "bad", notifiedAt: null, openedAt: 1 }, 2), true);
assert.equal(shouldNotifyInstant({ level: "bad", notifiedAt: null, openedAt: 1 }, 1 + 25 * 3600_000), false, "old alerts are not emailed");
assert.equal(shouldNotifyInstant({ level: "warn", notifiedAt: null, openedAt: 1 }, 2), false, "warnings wait for the digest");
assert.equal(shouldNotifyInstant({ level: "bad", notifiedAt: 1, openedAt: 1 }, 2), false, "never twice");

const html = digestHtml(
  [
    { id: 1, tenantId: 7, tenantName: "Gym A", key: "billing:past_due", level: "bad", title: "Gym A is past due", detail: null, href: "/gyms/7/money", openedAt: 1, lastSeenAt: 1, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, snoozedUntil: null, assignedTo: null },
    { id: 2, tenantId: null, tenantName: null, key: "scheduler:x", level: "warn", title: "Backup late <b>", detail: null, href: "/jobs", openedAt: 1, lastSeenAt: 1, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, snoozedUntil: null, assignedTo: null },
  ],
  "https://admin.example",
);
assert.match(html, /1 needs action/);
assert.match(html, /1 to watch/);
assert.match(html, /href="https:\/\/admin\.example\/gyms\/7\/money"/);
assert.match(html, /Backup late &lt;b&gt;/, "titles are escaped");

type Sent = { to: string[]; subject: string; html: string };
function stub(ok: boolean) {
  const calls: Sent[] = [];
  const send = (async (m: Sent) => { calls.push(m); return ok ? { ok: true as const, id: "x" } : { ok: false as const, error: "boom" }; }) as unknown as Parameters<typeof sendInstantAlerts>[1];
  return { calls, send };
}
const KEY = "notify-test:";
// A scratch platform admin so the recipient lists are never empty, even on a fresh DB.
const SCRATCH_EMAIL = "notify-test-staff@example.test";
const notifiedAt = (key: string) => (controlSqlite.prepare("SELECT notified_at AS n FROM platform_alerts WHERE key = ?").get(key) as { n: number | null }).n;

/** Removes scratch rows, including any left by a crashed earlier run. */
function cleanupScratch(): void {
  controlSqlite.prepare("DELETE FROM platform_alerts WHERE key LIKE ?").run(KEY + "%");
  const stale = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").all(SCRATCH_EMAIL) as Array<{ id: number }>;
  for (const u of stale) controlSqlite.prepare("DELETE FROM platform_settings WHERE key = ?").run(`notify:${u.id}`);
  controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(SCRATCH_EMAIL);
}

async function main() {
  const now = Date.now();
  cleanupScratch();
  controlSqlite
    .prepare("INSERT INTO users (email, name, password_hash, role, is_platform_admin, is_active, platform_role) VALUES (?, 'Notify Test', 'x', 'staff', 1, 1, 'owner')")
    .run(SCRATCH_EMAIL);
  const insert = controlSqlite.prepare("INSERT INTO platform_alerts (tenant_id, key, level, title, opened_at, last_seen_at) VALUES (NULL, ?, 'bad', ?, ?, ?)");
  // Park real open alerts so only the scratch rows are considered.
  const parked = (controlSqlite.prepare("SELECT id FROM platform_alerts WHERE resolved_at IS NULL AND level = 'bad' AND notified_at IS NULL").all() as Array<{ id: number }>).map((r) => r.id);
  for (const id of parked) controlSqlite.prepare("UPDATE platform_alerts SET notified_at = 1 WHERE id = ?").run(id);
  const prevClaim = controlSqlite.prepare("SELECT value FROM cron_state WHERE key = 'alert_digest_last_run'").get() as { value: string } | undefined;
  try {
    controlSqlite.prepare("DELETE FROM platform_alerts WHERE key LIKE ?").run(KEY + "%");
    insert.run(KEY + "new", "New <thing>\nbroke", now, now);
    insert.run(KEY + "old", "Old thing", now - 3 * 86400_000, now);
    const a = stub(true);
    assert.equal(await sendInstantAlerts(now, a.send), 1);
    assert.equal(a.calls.length, 1, "one email");
    assert.ok(a.calls[0].to.includes(SCRATCH_EMAIL), "scratch staff member is a recipient");
    assert.match(a.calls[0].html, /New &lt;thing&gt;/);
    assert.doesNotMatch(a.calls[0].html, /Old thing/, "long-open alert is not listed");
    assert.doesNotMatch(a.calls[0].subject, /[\r\n]/);
    assert.ok(notifiedAt(KEY + "new") !== null && notifiedAt(KEY + "old") !== null, "both rows marked notified");
    assert.equal(await sendInstantAlerts(now, a.send), 0);
    assert.equal(a.calls.length, 1, "never twice");

    controlSqlite.prepare("UPDATE platform_alerts SET notified_at = NULL WHERE key = ?").run(KEY + "new");
    const f = stub(false);
    assert.equal(await sendInstantAlerts(now, f.send), 0);
    assert.equal(f.calls.length, 1);
    assert.equal(notifiedAt(KEY + "new"), null, "claim released after a failed send");

    // Digest
    controlSqlite.prepare("DELETE FROM cron_state WHERE key = 'alert_digest_last_run'").run();
    const day = new Date("2031-06-10T00:00:00Z").getTime(); // IST: Dublin is UTC+1
    const early = day + 6 * 3600_000 + 30 * 60_000; // 07:30 Dublin
    const nine = day + 8 * 3600_000; // 09:00 Dublin
    const d = stub(true);
    assert.equal(await sendDailyDigest(early, d.send), false);
    assert.equal(d.calls.length, 0, "nothing before 08:00");
    assert.equal(await sendDailyDigest(nine, d.send), true);
    assert.equal(d.calls.length, 1);
    assert.ok(d.calls[0].to.includes(SCRATCH_EMAIL), "scratch staff member gets the digest");
    assert.equal(await sendDailyDigest(nine + 60_000, d.send), false);
    assert.equal(d.calls.length, 1, "once a day");
    const next = nine + 86400_000;
    const df = stub(false);
    assert.equal(await sendDailyDigest(next, df.send), false);
    assert.equal(df.calls.length, 1);
    assert.equal(await sendDailyDigest(next + 60_000, d.send), true);
    assert.equal(d.calls.length, 2, "a failed digest is retried");
    console.log("notify.test.ts: ok");
  } finally {
    cleanupScratch();
    for (const id of parked) controlSqlite.prepare("UPDATE platform_alerts SET notified_at = NULL WHERE id = ?").run(id);
    controlSqlite.prepare("DELETE FROM cron_state WHERE key = 'alert_digest_last_run'").run();
    if (prevClaim) controlSqlite.prepare("INSERT INTO cron_state (key, value) VALUES ('alert_digest_last_run', ?)").run(prevClaim.value);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
