// Run: npm test -- src/lib/platform/alertSources.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { billingAlerts, aiCapAlert, schedulerAlerts, jobAlerts } = requireLocal("./alertSources") as typeof import("./alertSources");

const base = { tenantId: 7, name: "Gym", status: "active", exempt: false, archived: false, nextRenewalAt: "2026-12-01", failedAttempts: 0, cardExpiry: null };
const keys = (xs: { key: string }[]) => xs.map((x) => x.key);

assert.deepEqual(billingAlerts(base, "2026-11-11"), []);
assert.deepEqual(keys(billingAlerts({ ...base, status: "past_due", failedAttempts: 2 }, "2026-11-11")), ["billing:past_due"]);
assert.equal(billingAlerts({ ...base, status: "past_due", failedAttempts: 3 }, "2026-11-11")[0].level, "bad", "three failed attempts is bad");
assert.equal(billingAlerts({ ...base, status: "past_due", failedAttempts: 1 }, "2026-11-11")[0].level, "warn");
assert.deepEqual(keys(billingAlerts({ ...base, status: "suspended" }, "2026-11-11")), ["billing:suspended"]);
assert.deepEqual(billingAlerts({ ...base, status: "past_due", exempt: true }, "2026-11-11"), [], "exempt businesses never bill");
assert.deepEqual(billingAlerts({ ...base, status: "suspended", archived: true }, "2026-11-11"), [], "archived businesses are not alerts");
assert.deepEqual(keys(billingAlerts({ ...base, status: "pending_payment", nextRenewalAt: null }, "2026-11-11")), ["billing:pending_long"]);
assert.deepEqual(keys(billingAlerts({ ...base, cardExpiry: "11/26" }, "2026-11-11")), ["billing:card_expiring"], "card expiring this month");
assert.deepEqual(keys(billingAlerts({ ...base, cardExpiry: "12/26" }, "2026-11-11")), ["billing:card_expiring"], "or next month");
assert.deepEqual(billingAlerts({ ...base, cardExpiry: "03/27" }, "2026-11-11"), []);

assert.equal(aiCapAlert(7, "Gym", 1000, 2500), null);
assert.equal(aiCapAlert(7, "Gym", 2300, 2500)?.level, "warn", "90% is a warning");
assert.equal(aiCapAlert(7, "Gym", 2500, 2500)?.level, "bad", "at the cap is bad");
assert.equal(aiCapAlert(7, "Gym", 100, 0), null, "no cap, no alert");

const sched = [{ key: "last_daily_run", label: "Daily jobs", lastRun: "2026-11-11" }, { key: "backup_last_run", label: "Backup", lastRun: "2026-11-09" }, { key: "x", label: "Never", lastRun: null }];
assert.deepEqual(keys(schedulerAlerts(sched, "2026-11-11")), ["scheduler:backup_last_run", "scheduler:x"]);
assert.equal(schedulerAlerts(sched, "2026-11-11")[0].level, "bad", "two days late is bad");
assert.deepEqual(schedulerAlerts([{ key: "a", label: "A", lastRun: "2026-11-10" }], "2026-11-11"), [], "yesterday is fine");

const runs = [
  { id: 1, key: "nightly_backup", label: "Nightly backup", startedAt: 1, finishedAt: 2, ok: false, error: "disk", durationMs: 1, detail: null },
  { id: 2, key: "billing_run", label: "Billing run", startedAt: 1, finishedAt: 2, ok: true, error: null, durationMs: 1, detail: null },
  { id: 3, key: "health_snapshot", label: "Health snapshot", startedAt: 1, finishedAt: null, ok: null, error: null, durationMs: null, detail: null },
];
assert.deepEqual(keys(jobAlerts(runs)), ["job:nightly_backup"]);
assert.match(jobAlerts(runs)[0].title, /disk/);
console.log("alertSources.test.ts: ok");
