// Run: npm test -- src/lib/platform/jobRuns.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { recordJobRun, listJobRuns, latestJobRuns, pruneHistory } = requireLocal("./jobRuns") as typeof import("./jobRuns");

  const key = `test_job_${Date.now()}`;
  const cleanup = () => controlSqlite.prepare("DELETE FROM job_runs WHERE key LIKE 'test_job_%'").run();

  try {
    // 1. a run that succeeds records ok, a duration and the returned detail.
    const out = await recordJobRun(key, "Test job", async () => ({ sent: 3 }));
    assert.deepEqual(out, { sent: 3 });
    let rows = listJobRuns({ key });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].error, null);
    assert.ok(rows[0].durationMs !== null && rows[0].durationMs >= 0);
    assert.deepEqual(rows[0].detail, { sent: 3 });

    // 2. a run that throws records the error and rethrows.
    await assert.rejects(
      () => recordJobRun(key, "Test job", async () => { throw new Error("boom"); }),
      /boom/,
    );
    rows = listJobRuns({ key });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].error, "boom");

    // 3. latest gives one row per key, the newest.
    const latest = latestJobRuns().filter((r) => r.key === key);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].ok, false);

    // 4. broken bookkeeping never blocks or fails the job.
    const origErr = console.error;
    let blocked = 0;
    console.error = () => { blocked++; };
    controlSqlite.exec("ALTER TABLE job_runs RENAME TO job_runs_bak");
    try {
      const v = await recordJobRun(key, "Test job", async () => 42);
      assert.equal(v, 42);
      assert.ok(blocked > 0, "the patch must actually block bookkeeping");
      await assert.rejects(
        () => recordJobRun(key, "Test job", async () => { throw new Error("own error"); }),
        /own error/,
      );
    } finally {
      controlSqlite.exec("ALTER TABLE job_runs_bak RENAME TO job_runs");
      console.error = origErr;
    }

    // 5. detail over 4000 chars is stored as null.
    const bigKey = `test_job_big_${Date.now()}`;
    await recordJobRun(bigKey, "Big", async () => ({ s: "x".repeat(5000) }));
    assert.equal(listJobRuns({ key: bigKey })[0].detail, null);

    // 6. pruneHistory removes old rows and keeps recent ones.
    const DAY = 86400000;
    const now = Date.now();
    const oldKey = `test_job_old_${now}`;
    controlSqlite.prepare("INSERT INTO job_runs (key, label, started_at) VALUES (?, 'old', ?)").run(oldKey, now - 100 * DAY);
    controlSqlite.prepare("INSERT INTO job_runs (key, label, started_at) VALUES (?, 'new', ?)").run(oldKey, now - 1 * DAY);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('prune-test','Prune Test','tenants/prune-test/void.db',1) RETURNING id")
      .get() as { id: number };
    try {
      const ins = controlSqlite.prepare("INSERT INTO health_snapshots (tenant_id, at) VALUES (?, ?)");
      ins.run(t.id, now - 100 * DAY);
      ins.run(t.id, now - 1 * DAY);
      const r = pruneHistory(now, 90);
      assert.ok(r.jobRuns >= 1 && r.snapshots >= 1);
      assert.equal(listJobRuns({ key: oldKey }).length, 1);
      assert.equal(listJobRuns({ key: oldKey })[0].label, "new");
      const left = controlSqlite.prepare("SELECT COUNT(*) AS n FROM health_snapshots WHERE tenant_id = ?").get(t.id) as { n: number };
      assert.equal(left.n, 1);
    } finally {
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    }

    console.log("jobRuns.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
