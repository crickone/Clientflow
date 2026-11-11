// Run: npm test -- src/lib/platform/jobRuns.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { recordJobRun, listJobRuns, latestJobRuns } = requireLocal("./jobRuns") as typeof import("./jobRuns");

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

    console.log("jobRuns.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
