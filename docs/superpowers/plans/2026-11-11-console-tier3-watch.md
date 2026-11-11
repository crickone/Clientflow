# Console Tier 3: Watch. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The console tells the operator what needs doing: one ranked inbox of alerts across every business (billing, integrations, AI caps, stale jobs, database health), email the moment a serious one opens plus a morning digest, 30-day health graphs per business, real charts on the dashboard, MRR movements by month, and a page that shows every background job's run history.

**Architecture:** Tier 1 already stores `health_snapshots`, `job_runs` and `platform_alerts` and reconciles health alerts hourly. Tier 3 widens the alert candidates (billing, integrations, AI cap, stale schedulers, failed jobs), adds ack/snooze/assign, and notifies platform staff by email (instant for `bad`, 08:00 Dublin digest for everything open). Charts are inline SVG components in the console (no chart library), fed by new analytics fields and the snapshot history.

**Tech Stack:** As Tiers 1 and 2. No new dependencies.

## Global Constraints

- Everything in Tier 1's and Tier 2's Global Constraints.
- Charts follow the dataviz rules: one accent for the series that matters, grey for context, labelled axes, numbers in mono tabular figures, nothing drawn for a flat zero line (say "No movement yet" instead).
- Email to platform staff goes through `sendPlatformEmail` from `@/lib/email` (object form: `{ to, subject, html }`). Never more than one instant email per alert, never more than one digest per day.
- Alerts carry a console `href` so every row in the inbox is one click from the place to fix it.

---

## File structure

**app/**

| File | Responsibility |
|---|---|
| `src/lib/platform/alertSources.ts` (create) | `collectAlertCandidates(now)`: health + billing + integrations + AI cap + stale schedulers + failed jobs → `AlertCandidate[]`. |
| `src/lib/platform/alertSources.test.ts` (create) | Pure rule tests (`billingAlerts`, `aiCapAlert`, `schedulerAlerts`, `jobAlerts`). |
| `src/lib/platform/healthHistory.ts` (modify) | `snapshotFleetHealth` uses `collectAlertCandidates`; add `listOpenAlerts`, `alertAction`, `listAlertHistory`. |
| `src/lib/platform/notify.ts` (create) | Instant emails for new `bad` alerts; the daily digest; per-staff preferences. |
| `src/lib/platform/notify.test.ts` (create) | Pure: `digestHtml`, `shouldNotifyInstant`. |
| `src/lib/platform/healthScheduler.ts` (modify) | After each sync: instant notifications; at 08:00 Dublin: digest. |
| `src/lib/platform/mrr.ts` + `.test.ts` (create) | Pure MRR movements from billing events + invoices. |
| `src/lib/platform/analytics.ts` (modify) | Adds `aiSpendByMonth`, `emailByMonth`, `churnedByMonth`, `mrrMovements`. |
| `src/lib/billing/engine.ts` (modify) | `logEvent("price_changed")` when a price override is set (needed for expansion/contraction). |
| `src/app/api/platform/alerts/route.ts` (create) | GET open alerts (+ counts), POST ack/snooze/assign. |
| `src/app/api/platform/jobs/route.ts` (create) | GET latest + history per job. |
| `src/app/api/platform/tenants/[id]/health/route.ts` (modify) | GET gains `?history=days`. |
| `src/app/api/platform/staff/route.ts` (modify) | GET includes each staff member's notification prefs for themselves; PATCH accepts `{ notify: {...} }`. |

**admin/**

| File | Responsibility |
|---|---|
| `src/lib/types.ts` (modify) | `PlatformAlert`, `AlertsResponse`, `JobRun`, `JobsResponse`, `HealthHistoryPoint`, analytics additions, `NotifyPrefs`. |
| `src/components/charts/LineChart.tsx` (create) | Inline SVG multi-series line chart with axes and hover. |
| `src/components/charts/BarChart.tsx` (create) | Inline SVG grouped bars (MRR movements). |
| `src/lib/chart.ts` + `.test.ts` (create) | Pure scale/tick helpers. |
| `src/app/(console)/inbox/page.tsx` (create) | The alerts inbox. |
| `src/components/inbox/AlertList.tsx` (create) | Client rows with ack/snooze/assign. |
| `src/app/(console)/inbox/actions.ts` (create) | Server actions. |
| `src/app/(console)/jobs/page.tsx` (create) | Job runs page. |
| `src/components/jobs/RunStrip.tsx` (create) | 30-run strip. |
| `src/app/(console)/page.tsx` (modify) | Inbox panel at the top; trend charts; MRR movements. |
| `src/app/(console)/gyms/[id]/health/page.tsx` + `src/components/health/HealthPanel.tsx` (modify) | 30-day graphs. |
| `src/app/(console)/settings/page.tsx` + `actions.ts` (modify) | Notification preferences card. |
| `src/components/Shell.tsx` (modify) | Inbox and Jobs in the nav; inbox count badge. |
| `src/app/(console)/layout.tsx` (modify) | Loads the open-alert count for the badge. |
| `src/app/globals.css` (modify) | Inbox, chart, run strip styles. |

---

### Task 1: Alert sources (main app)

**Files:**
- Create: `app/src/lib/platform/alertSources.ts`, `app/src/lib/platform/alertSources.test.ts`
- Modify: `app/src/lib/platform/healthHistory.ts`

**Interfaces:**
- Produces (pure, exported for tests):

```ts
export interface BillingFacts { tenantId: number; name: string; status: string | null; exempt: boolean; archived: boolean; nextRenewalAt: string | null; failedAttempts: number; cardExpiry: string | null }
export function billingAlerts(f: BillingFacts, today: string): AlertCandidate[]
export function aiCapAlert(tenantId: number, name: string, usedCents: number, capCents: number): AlertCandidate | null
export function schedulerAlerts(schedulers: { key: string; label: string; lastRun: string | null }[], today: string): AlertCandidate[]
export function jobAlerts(latest: JobRunRow[]): AlertCandidate[]
export function collectAlertCandidates(now?: number): { candidates: AlertCandidate[]; tenantIds: number[] }
```

Alert keys: `billing:past_due`, `billing:suspended`, `billing:pending_long`, `billing:card_expiring`, `ai:cap`, `integration:facebook`, `integration:meta`, `scheduler:<key>`, `job:<key>`, plus Tier 1's `health:<key>` and `site_slug:<slug>`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/platform/alertSources.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/alertSources.test.ts`
Expected: `Cannot find module './alertSources'`.

- [ ] **Step 3: Write the module**

`app/src/lib/platform/alertSources.ts`:

```ts
import "server-only";

import { controlSqlite, getCronState } from "@/lib/db/control";
import { getMonthlyUsageCents, getTenantCapCents } from "@/lib/ai/usage";
import { dublinToday } from "@/lib/billing/dates";
import { getFleetHealth, getTenantHealth } from "./health";
import { latestJobRuns, type JobRunRow } from "./jobRuns";
import type { AlertCandidate } from "./healthHistory";

/**
 * Everything that can need a platform operator, as alert candidates for
 * syncPlatformAlerts. The rules are pure functions over plain facts so they
 * can be tested without a database; collectAlertCandidates gathers the
 * facts. Keys are stable per problem, so one problem is one open alert.
 */

export interface BillingFacts {
  tenantId: number;
  name: string;
  status: string | null;
  exempt: boolean;
  archived: boolean;
  nextRenewalAt: string | null;
  failedAttempts: number;
  /** "MM/YY" as stored on the card row. */
  cardExpiry: string | null;
}

function monthsAhead(today: string, n: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
}

export function billingAlerts(f: BillingFacts, today: string): AlertCandidate[] {
  if (f.archived || f.exempt || !f.status) return [];
  const out: AlertCandidate[] = [];
  const href = `/gyms/${f.tenantId}/money`;
  if (f.status === "past_due") {
    out.push({
      tenantId: f.tenantId,
      key: "billing:past_due",
      level: f.failedAttempts >= 3 ? "bad" : "warn",
      title: `${f.name} is past due (${f.failedAttempts} failed ${f.failedAttempts === 1 ? "attempt" : "attempts"})`,
      href,
    });
  } else if (f.status === "suspended") {
    out.push({ tenantId: f.tenantId, key: "billing:suspended", level: "bad", title: `${f.name} is suspended for non-payment`, href });
  } else if (f.status === "pending_payment" && !f.nextRenewalAt) {
    out.push({ tenantId: f.tenantId, key: "billing:pending_long", level: "warn", title: `${f.name} has never paid; no card on file`, href });
  }
  if (f.cardExpiry && (f.cardExpiry === monthsAhead(today, 0) || f.cardExpiry === monthsAhead(today, 1))) {
    out.push({ tenantId: f.tenantId, key: "billing:card_expiring", level: "warn", title: `${f.name}'s card expires ${f.cardExpiry}`, href });
  }
  return out;
}

export function aiCapAlert(tenantId: number, name: string, usedCents: number, capCents: number): AlertCandidate | null {
  if (capCents <= 0) return null;
  const ratio = usedCents / capCents;
  if (ratio < 0.9) return null;
  return {
    tenantId,
    key: "ai:cap",
    level: ratio >= 1 ? "bad" : "warn",
    title: ratio >= 1 ? `${name} has hit its AI cap; Adonis is refusing paid calls` : `${name} is at ${Math.round(ratio * 100)}% of its AI cap`,
    href: `/gyms/${tenantId}/money`,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function schedulerAlerts(schedulers: { key: string; label: string; lastRun: string | null }[], today: string): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const s of schedulers) {
    const late = s.lastRun ? daysBetween(s.lastRun, today) : Infinity;
    if (late <= 1) continue;
    out.push({
      tenantId: null,
      key: `scheduler:${s.key}`,
      level: late >= 2 ? "bad" : "warn",
      title: s.lastRun ? `${s.label} last ran ${s.lastRun}, ${late} days ago` : `${s.label} has never run`,
      href: "/jobs",
    });
  }
  return out;
}

export function jobAlerts(latest: JobRunRow[]): AlertCandidate[] {
  return latest
    .filter((r) => r.ok === false)
    .map((r) => ({ tenantId: null, key: `job:${r.key}`, level: "bad" as const, title: `${r.label} failed: ${r.error ?? "unknown error"}`, href: "/jobs" }));
}

export function collectAlertCandidates(now: number = Date.now()): { candidates: AlertCandidate[]; tenantIds: number[] } {
  const today = dublinToday(new Date(now));
  const candidates: AlertCandidate[] = [];
  const fleet = getFleetHealth();
  const tenantIds = fleet.tenants.map((t) => t.tenantId);

  // Health, per business (same as Tier 1).
  for (const row of fleet.tenants) {
    let h;
    try { h = getTenantHealth(row.tenantId); } catch { continue; }
    for (const a of h.alerts) candidates.push({ tenantId: row.tenantId, key: `health:${a.key}`, level: a.level, title: `${row.name}: ${a.message}`, href: `/gyms/${row.tenantId}/health` });
  }
  for (const d of fleet.duplicateSiteSlugs) {
    candidates.push({ tenantId: null, key: `site_slug:${d.slug}`, level: "bad", title: `Site slug "${d.slug}" is used by ${d.owners.length} businesses; only ${d.servedBy} is reachable.`, href: "/health" });
  }

  // Billing.
  const billing = controlSqlite
    .prepare(
      `SELECT t.id, t.name, t.archived_at, b.status, b.billing_exempt, b.next_renewal_at, b.failed_attempts, b.card_expiry
       FROM tenants t LEFT JOIN tenant_billing b ON b.tenant_id = t.id WHERE t.is_active = 1`,
    )
    .all() as Array<{ id: number; name: string; archived_at: number | null; status: string | null; billing_exempt: number | null; next_renewal_at: string | null; failed_attempts: number | null; card_expiry: string | null }>;
  for (const b of billing) {
    candidates.push(...billingAlerts({ tenantId: b.id, name: b.name, status: b.status, exempt: Boolean(b.billing_exempt), archived: b.archived_at !== null, nextRenewalAt: b.next_renewal_at, failedAttempts: b.failed_attempts ?? 0, cardExpiry: b.card_expiry }, today));
    // AI cap.
    try {
      const a = aiCapAlert(b.id, b.name, getMonthlyUsageCents(b.id), getTenantCapCents(b.id));
      if (a) candidates.push(a);
    } catch {
      // a tenant whose usage cannot be read is not an AI-cap problem
    }
  }

  // Integrations that asked to be reconnected.
  const fb = controlSqlite
    .prepare(`SELECT p.tenant_id, t.name, p.page_name, p.needs_reconnect_reason FROM facebook_pages p JOIN tenants t ON t.id = p.tenant_id WHERE p.needs_reconnect_at IS NOT NULL AND p.revoked_at IS NULL`)
    .all() as Array<{ tenant_id: number; name: string; page_name: string; needs_reconnect_reason: string | null }>;
  for (const p of fb) candidates.push({ tenantId: p.tenant_id, key: "integration:facebook", level: "warn", title: `${p.name}: Facebook Page "${p.page_name}" needs reconnecting${p.needs_reconnect_reason ? ` (${p.needs_reconnect_reason})` : ""}`, href: `/gyms/${p.tenant_id}/integrations` });
  const meta = controlSqlite
    .prepare(`SELECT g.tenant_id, t.name, g.needs_reconnect_reason FROM meta_grants g JOIN tenants t ON t.id = g.tenant_id WHERE g.needs_reconnect_at IS NOT NULL`)
    .all() as Array<{ tenant_id: number; name: string; needs_reconnect_reason: string | null }>;
  for (const g of meta) candidates.push({ tenantId: g.tenant_id, key: "integration:meta", level: "warn", title: `${g.name}: the Meta connection needs reconnecting${g.needs_reconnect_reason ? ` (${g.needs_reconnect_reason})` : ""}`, href: `/gyms/${g.tenant_id}/integrations` });

  // Platform-wide: stale schedulers and failed jobs.
  const schedulers = [
    { key: "last_daily_run", label: "Daily jobs", lastRun: safe("last_daily_run") },
    { key: "lapse_last_run", label: "Lapsed-member sweep", lastRun: safe("lapse_last_run") },
    { key: "billing_last_run", label: "Billing run", lastRun: safe("billing_last_run") },
    { key: "backup_last_run", label: "Nightly backup", lastRun: safe("backup_last_run") },
  ];
  candidates.push(...schedulerAlerts(schedulers, today));
  candidates.push(...jobAlerts(latestJobRuns()));

  return { candidates, tenantIds };
}

function safe(key: string): string | null {
  try { return getCronState(key); } catch { return null; }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/alertSources.test.ts`
Expected: `alertSources.test.ts: ok`.

- [ ] **Step 5: Use it from the snapshot, and add the read/act functions**

In `app/src/lib/platform/healthHistory.ts`, replace the `snapshotFleetHealth` function body's alert-building (keep the snapshot insert loop) so it ends with:

```ts
  const { candidates, tenantIds: ids } = collectAlertCandidates(now);
  const r = syncPlatformAlerts(candidates, now, { tenantIds: ids, platform: true });
  return { tenants: fleet.tenants.length, opened: r.opened, resolved: r.resolved };
```

(remove the inline `candidates` building and the `tenantIds` array it used; add `import { collectAlertCandidates } from "./alertSources";`. The snapshot insert loop still iterates `fleet.tenants` and calls `getTenantHealth`.)

Then append:

```ts
export interface PlatformAlertRow {
  id: number;
  tenantId: number | null;
  tenantName: string | null;
  key: string;
  level: "warn" | "bad";
  title: string;
  detail: string | null;
  href: string | null;
  openedAt: number;
  lastSeenAt: number;
  resolvedAt: number | null;
  acknowledgedAt: number | null;
  acknowledgedBy: number | null;
  snoozedUntil: number | null;
  assignedTo: number | null;
}

type RawAlert = {
  id: number; tenant_id: number | null; tenant_name: string | null; key: string; level: "warn" | "bad"; title: string; detail: string | null;
  href: string | null; opened_at: number; last_seen_at: number; resolved_at: number | null; acknowledged_at: number | null;
  acknowledged_by: number | null; snoozed_until: number | null; assigned_to: number | null;
};
const toAlert = (r: RawAlert): PlatformAlertRow => ({
  id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, key: r.key, level: r.level, title: r.title, detail: r.detail, href: r.href,
  openedAt: r.opened_at, lastSeenAt: r.last_seen_at, resolvedAt: r.resolved_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by,
  snoozedUntil: r.snoozed_until, assignedTo: r.assigned_to,
});
const SELECT = `SELECT a.*, t.name AS tenant_name FROM platform_alerts a LEFT JOIN tenants t ON t.id = a.tenant_id`;

/** Open alerts, bad first, then oldest first. Snoozed ones are included when `includeSnoozed`. */
export function listOpenAlerts(opts: { tenantId?: number; includeSnoozed?: boolean; now?: number } = {}): PlatformAlertRow[] {
  const now = opts.now ?? Date.now();
  const where = ["a.resolved_at IS NULL"];
  const args: unknown[] = [];
  if (opts.tenantId !== undefined) { where.push("a.tenant_id = ?"); args.push(opts.tenantId); }
  if (!opts.includeSnoozed) { where.push("(a.snoozed_until IS NULL OR a.snoozed_until <= ?)"); args.push(now); }
  const rows = controlSqlite
    .prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY CASE a.level WHEN 'bad' THEN 0 ELSE 1 END, a.acknowledged_at IS NOT NULL, a.opened_at`)
    .all(...args) as RawAlert[];
  return rows.map(toAlert);
}

export function listAlertHistory(tenantId: number, limit = 50): PlatformAlertRow[] {
  return (controlSqlite.prepare(`${SELECT} WHERE a.tenant_id = ? ORDER BY a.opened_at DESC LIMIT ?`).all(tenantId, limit) as RawAlert[]).map(toAlert);
}

export type AlertOp =
  | { op: "ack" }
  | { op: "unack" }
  | { op: "snooze"; until: number }
  | { op: "assign"; userId: number | null };

export function alertAction(id: number, op: AlertOp, actorUserId: number, now: number = Date.now()): { ok: true } | { ok: false; error: string } {
  const exists = controlSqlite.prepare("SELECT id FROM platform_alerts WHERE id = ? AND resolved_at IS NULL").get(id);
  if (!exists) return { ok: false, error: "That alert is closed or does not exist." };
  switch (op.op) {
    case "ack":
      controlSqlite.prepare("UPDATE platform_alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?").run(now, actorUserId, id);
      return { ok: true };
    case "unack":
      controlSqlite.prepare("UPDATE platform_alerts SET acknowledged_at = NULL, acknowledged_by = NULL WHERE id = ?").run(id);
      return { ok: true };
    case "snooze":
      if (op.until <= now) return { ok: false, error: "Snooze until a time in the future." };
      controlSqlite.prepare("UPDATE platform_alerts SET snoozed_until = ? WHERE id = ?").run(op.until, id);
      return { ok: true };
    case "assign":
      controlSqlite.prepare("UPDATE platform_alerts SET assigned_to = ? WHERE id = ?").run(op.userId, id);
      return { ok: true };
  }
}

export function countOpenAlerts(now: number = Date.now()): { bad: number; warn: number } {
  const rows = controlSqlite
    .prepare("SELECT level, count(*) AS n FROM platform_alerts WHERE resolved_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?) GROUP BY level")
    .all(now) as Array<{ level: "warn" | "bad"; n: number }>;
  return { bad: rows.find((r) => r.level === "bad")?.n ?? 0, warn: rows.find((r) => r.level === "warn")?.n ?? 0 };
}
```

Add to `healthHistory.test.ts` before the final `console.log`:

```ts
    // 5. act on an alert.
    const { alertAction, listOpenAlerts } = requireLocal("./healthHistory") as typeof import("./healthHistory");
    const openOne = listOpenAlerts({ tenantId: tid })[0];
    assert.ok(openOne);
    assert.deepEqual(alertAction(openOne.id, { op: "snooze", until: 9000 }, 1, 5000), { ok: true });
    assert.equal(listOpenAlerts({ tenantId: tid, now: 6000 }).length, 0, "snoozed is hidden");
    assert.equal(listOpenAlerts({ tenantId: tid, now: 9001 }).length, 1, "and back when the snooze ends");
    assert.deepEqual(alertAction(openOne.id, { op: "ack" }, 1, 7000), { ok: true });
    assert.equal(listOpenAlerts({ tenantId: tid, now: 9001 })[0].acknowledgedBy, 1);
    assert.equal(alertAction(999999999, { op: "ack" }, 1).ok, false);
```

Run: `cd app && npm test -- src/lib/platform/healthHistory.test.ts`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/platform/alertSources.ts app/src/lib/platform/alertSources.test.ts app/src/lib/platform/healthHistory.ts app/src/lib/platform/healthHistory.test.ts
git commit -m "feat(platform): alerts from billing, AI caps, integrations, stale schedulers and failed jobs; ack, snooze, assign

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Alerts and jobs routes (main app)

**Files:**
- Create: `app/src/app/api/platform/alerts/route.ts`, `app/src/app/api/platform/jobs/route.ts`
- Modify: `app/src/app/api/platform/tenants/[id]/health/route.ts`

**Interfaces:**
- `GET /alerts?tenantId&snoozed=1` → `{ alerts: PlatformAlertRow[]; counts: { bad; warn } }`
- `POST /alerts { id, op: "ack"|"unack"|"snooze"|"assign", until?, userId? }` → `{ ok }` (audited as `alert.<op>`)
- `GET /jobs?key&limit` → `{ latest: JobRunRow[]; history: JobRunRow[] }`
- `GET /tenants/:id/health?history=30` → existing body plus `{ history: HealthSnapshotRow[], alerts: PlatformAlertRow[] }`

- [ ] **Step 1: Routes**

`app/src/app/api/platform/alerts/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { alertAction, countOpenAlerts, listOpenAlerts } from "@/lib/platform/healthHistory";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  const tenantId = Number(sp.get("tenantId"));
  return NextResponse.json({
    alerts: listOpenAlerts({ tenantId: Number.isInteger(tenantId) && tenantId > 0 ? tenantId : undefined, includeSnoozed: sp.get("snoozed") === "1" }),
    counts: countOpenAlerts(),
  });
}

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("ack"), id: z.number().int().positive() }),
  z.object({ op: z.literal("unack"), id: z.number().int().positive() }),
  z.object({ op: z.literal("snooze"), id: z.number().int().positive(), until: z.number().int().positive() }),
  z.object({ op: z.literal("assign"), id: z.number().int().positive(), userId: z.number().int().positive().nullable() }),
]);

export async function POST(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  const { id, ...op } = parsed.data;
  const r = alertAction(id, op, g.userId);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: null, action: `alert.${op.op}`, detail: { id, ...op }, ip: requestIp(req), ok: r.ok, error: r.ok ? null : r.error });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
```

`app/src/app/api/platform/jobs/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { latestJobRuns, listJobRuns } from "@/lib/platform/jobRuns";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  const key = sp.get("key") || undefined;
  const limit = Number(sp.get("limit")) || 30;
  return NextResponse.json({ latest: latestJobRuns(), history: listJobRuns({ key, limit }) });
}
```

In `app/src/app/api/platform/tenants/[id]/health/route.ts` `GET`, where it returns `NextResponse.json(getTenantHealth(tenantId, { deep: true }))` (or similar), change to:

```ts
  const days = Number(req.nextUrl.searchParams.get("history")) || 0;
  const health = getTenantHealth(tenantId, { deep: true });
  return NextResponse.json({
    ...health,
    history: days > 0 ? listHealthHistory(tenantId, Date.now() - days * 86400000) : [],
    alerts: health.alerts,
    openAlerts: listOpenAlerts({ tenantId, includeSnoozed: true }),
    alertHistory: listAlertHistory(tenantId, 30),
  });
```

(import `listHealthHistory`, `listOpenAlerts`, `listAlertHistory` from `@/lib/platform/healthHistory`.)

- [ ] **Step 2: Typecheck and commit**

Run: `cd app && npx tsc --noEmit -p .`

```bash
git add app/src/app/api/platform/alerts/route.ts app/src/app/api/platform/jobs/route.ts "app/src/app/api/platform/tenants/[id]/health/route.ts"
git commit -m "feat(platform): alerts, jobs and health-history endpoints for the console

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Notifications (main app)

**Files:**
- Create: `app/src/lib/platform/notify.ts`, `app/src/lib/platform/notify.test.ts`
- Modify: `app/src/lib/platform/healthScheduler.ts`, `app/src/app/api/platform/staff/route.ts`

**Interfaces:**
- `NotifyPrefs = { instant: boolean; digest: boolean }` per staff member, stored in `platform_settings` under `notify:<userId>` (default both true).
- `getNotifyPrefs(userId)`, `setNotifyPrefs(userId, prefs)`.
- `shouldNotifyInstant(alert: { level; notifiedAt: number | null; openedAt: number }, now): boolean` (pure): only `bad`, never twice.
- `digestHtml(alerts: PlatformAlertRow[], baseUrl: string): string` (pure).
- `sendInstantAlerts(now?)`: emails staff with `instant` on about open `bad` alerts not yet notified; marks `notified_at`.
- `sendDailyDigest(now?)`: once per Dublin day at or after 08:00, emails staff with `digest` on a list of every open alert; skipped when none are open. Guarded by `claimDailyRun("alert_digest_last_run", today)`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/platform/notify.test.ts`:

```ts
// Run: npm test -- src/lib/platform/notify.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { shouldNotifyInstant, digestHtml } = requireLocal("./notify") as typeof import("./notify");

assert.equal(shouldNotifyInstant({ level: "bad", notifiedAt: null, openedAt: 1 }, 2), true);
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
console.log("notify.test.ts: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/notify.test.ts`
Expected: `Cannot find module './notify'`.

- [ ] **Step 3: Write the module**

`app/src/lib/platform/notify.ts`:

```ts
import "server-only";

import { claimDailyRun, controlSqlite } from "@/lib/db/control";
import { escapeHtml, sendPlatformEmail } from "@/lib/email";
import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";
import { dublinToday } from "@/lib/billing/dates";
import { listPlatformStaff } from "./roles";
import { listOpenAlerts, type PlatformAlertRow } from "./healthHistory";

/**
 * Tell platform staff. A `bad` alert emails the moment it opens, once. At
 * 08:00 Dublin a digest lists everything still open. Each staff member can
 * switch either off for themselves.
 */
export interface NotifyPrefs { instant: boolean; digest: boolean }

const CONSOLE_URL = process.env.CONSOLE_URL ?? "https://admin.adonisagent.ie";

export function getNotifyPrefs(userId: number): NotifyPrefs {
  try {
    const raw = getPlatformSetting(`notify:${userId}`);
    const p = raw ? (JSON.parse(raw) as Partial<NotifyPrefs>) : {};
    return { instant: p.instant !== false, digest: p.digest !== false };
  } catch {
    return { instant: true, digest: true };
  }
}

export function setNotifyPrefs(userId: number, prefs: NotifyPrefs): void {
  setPlatformSetting(`notify:${userId}`, JSON.stringify({ instant: Boolean(prefs.instant), digest: Boolean(prefs.digest) }));
}

export function shouldNotifyInstant(a: { level: "warn" | "bad"; notifiedAt: number | null; openedAt: number }, now: number): boolean {
  void now;
  return a.level === "bad" && a.notifiedAt === null;
}

function recipients(kind: keyof NotifyPrefs): string[] {
  return listPlatformStaff()
    .filter((s) => s.isActive && getNotifyPrefs(s.userId)[kind])
    .map((s) => s.email);
}

function line(a: PlatformAlertRow, baseUrl: string): string {
  const link = a.href ? `${baseUrl}${a.href}` : baseUrl;
  return `<li style="margin:0 0 8px"><a href="${escapeHtml(link)}">${escapeHtml(a.title)}</a></li>`;
}

export function digestHtml(alerts: PlatformAlertRow[], baseUrl: string): string {
  const bad = alerts.filter((a) => a.level === "bad");
  const warn = alerts.filter((a) => a.level === "warn");
  return (
    `<p style="margin:0 0 12px">${bad.length} ${bad.length === 1 ? "needs" : "need"} action, ${warn.length} to watch.</p>` +
    (bad.length ? `<p style="margin:16px 0 6px"><strong>Needs action</strong></p><ul style="padding-left:18px">${bad.map((a) => line(a, baseUrl)).join("")}</ul>` : "") +
    (warn.length ? `<p style="margin:16px 0 6px"><strong>To watch</strong></p><ul style="padding-left:18px">${warn.map((a) => line(a, baseUrl)).join("")}</ul>` : "") +
    `<p style="margin:16px 0 0"><a href="${escapeHtml(baseUrl)}/inbox">Open the inbox</a></p>`
  );
}

/** Emails each newly opened `bad` alert once. Returns how many emails went out. */
export async function sendInstantAlerts(now: number = Date.now()): Promise<number> {
  const rows = controlSqlite
    .prepare("SELECT id, level, opened_at, notified_at FROM platform_alerts WHERE resolved_at IS NULL AND level = 'bad' AND notified_at IS NULL")
    .all() as Array<{ id: number; level: "bad"; opened_at: number; notified_at: number | null }>;
  const due = rows.filter((r) => shouldNotifyInstant({ level: r.level, notifiedAt: r.notified_at, openedAt: r.opened_at }, now));
  if (due.length === 0) return 0;
  // Claim first so a second process cannot send the same alert.
  const claimed = due.filter((r) => controlSqlite.prepare("UPDATE platform_alerts SET notified_at = ? WHERE id = ? AND notified_at IS NULL").run(now, r.id).changes > 0);
  if (claimed.length === 0) return 0;
  const to = recipients("instant");
  if (to.length === 0) return 0;
  const alerts = listOpenAlerts({ includeSnoozed: true, now }).filter((a) => claimed.some((c) => c.id === a.id));
  const res = await sendPlatformEmail({
    to,
    subject: alerts.length === 1 ? `[Adonis] ${alerts[0].title}` : `[Adonis] ${alerts.length} new alerts need action`,
    html: `<ul style="padding-left:18px">${alerts.map((a) => line(a, CONSOLE_URL)).join("")}</ul><p style="margin:16px 0 0"><a href="${CONSOLE_URL}/inbox">Open the inbox</a></p>`,
  });
  if (!res.ok) {
    console.error("[notify] instant alert email failed:", res.error);
    // Release the claim so the next sync tries again.
    for (const c of claimed) controlSqlite.prepare("UPDATE platform_alerts SET notified_at = NULL WHERE id = ?").run(c.id);
    return 0;
  }
  return 1;
}

/** Once per Dublin day, at or after 08:00, when anything is open. */
export async function sendDailyDigest(now: number = Date.now()): Promise<boolean> {
  const dublinHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  if (dublinHour < 8) return false;
  const today = dublinToday(new Date(now));
  const alerts = listOpenAlerts({ now });
  if (alerts.length === 0) return false;
  if (!claimDailyRun("alert_digest_last_run", today)) return false;
  const to = recipients("digest");
  if (to.length === 0) return false;
  const res = await sendPlatformEmail({ to, subject: `[Adonis] Morning: ${alerts.length} open ${alerts.length === 1 ? "alert" : "alerts"}`, html: digestHtml(alerts, CONSOLE_URL) });
  if (!res.ok) console.error("[notify] digest email failed:", res.error);
  return res.ok;
}
```

Check `escapeHtml` is exported from `@/lib/email` (`grep -n "export function escapeHtml" app/src/lib/email.ts`); `alerts/tenantAlerts.ts` already imports it from there.

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/notify.test.ts`
Expected: `notify.test.ts: ok`.

- [ ] **Step 5: Wire the scheduler and the staff route**

In `app/src/lib/platform/healthScheduler.ts` `runOnce`, after the `recordJobRun("health_snapshot", …)` line and inside the same `try`:

```ts
    await sendInstantAlerts();
    await sendDailyDigest();
```

with `import { sendDailyDigest, sendInstantAlerts } from "./notify";`. Also change the boot delay from 60s to run and then poll every 10 minutes for the digest window (the hourly tick alone could miss 08:00 by up to 59 minutes): add after `armNext();`:

```ts
  const digestTick = setInterval(() => void sendDailyDigest().catch((err) => console.error("[notify] digest:", err)), 10 * 60 * 1000);
  digestTick.unref();
```

In `app/src/app/api/platform/staff/route.ts`:
- `GET` returns `{ staff: listPlatformStaff(), you: { userId: g.userId, role: g.role, notify: getNotifyPrefs(g.userId) } }`.
- Add `PUT`:

```ts
const prefsSchema = z.object({ notify: z.object({ instant: z.boolean(), digest: z.boolean() }) });

/** A staff member's own notification preferences. Not audited: it is their own inbox. */
export async function PUT(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = prefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  setNotifyPrefs(g.userId, parsed.data.notify);
  return NextResponse.json({ ok: true, notify: getNotifyPrefs(g.userId) });
}
```

(import `z` from `zod` if not already, and `getNotifyPrefs`, `setNotifyPrefs` from `@/lib/platform/notify`.)

- [ ] **Step 6: Typecheck and commit**

Run: `cd app && npx tsc --noEmit -p .`

```bash
git add app/src/lib/platform/notify.ts app/src/lib/platform/notify.test.ts app/src/lib/platform/healthScheduler.ts app/src/app/api/platform/staff/route.ts
git commit -m "feat(platform): email platform staff when a serious alert opens, and a morning digest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: MRR movements and richer analytics (main app)

**Files:**
- Create: `app/src/lib/platform/mrr.ts`, `app/src/lib/platform/mrr.test.ts`
- Modify: `app/src/lib/platform/analytics.ts`, `app/src/lib/billing/engine.ts`

**Interfaces:**
- Pure:

```ts
export interface MrrEvent { tenantId: number; month: string; type: "activated" | "reactivated" | "suspended" | "offboarded" | "cancelled" | "price_changed"; priceCents: number; previousPriceCents?: number }
export interface MrrMovement { month: string; newCents: number; expansionCents: number; contractionCents: number; churnCents: number; reactivationCents: number; netCents: number }
export function mrrMovements(events: MrrEvent[], months: string[]): MrrMovement[]
```

- Analytics gains `platform.mrrMovements: MrrMovement[]`, `platform.churnedByMonth: { month; count }[]`, `gyms.aiSpendByMonth: { month; cents }[]`, `gyms.emailByMonth: { month; sent }[]`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/platform/mrr.test.ts`:

```ts
// Run: npm test -- src/lib/platform/mrr.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { mrrMovements } = requireLocal("./mrr") as typeof import("./mrr");

const months = ["2026-09", "2026-10", "2026-11"];
const out = mrrMovements(
  [
    { tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 },
    { tenantId: 2, month: "2026-09", type: "activated", priceCents: 20000 },
    { tenantId: 1, month: "2026-10", type: "price_changed", priceCents: 25000, previousPriceCents: 20000 },
    { tenantId: 2, month: "2026-10", type: "suspended", priceCents: 20000 },
    { tenantId: 2, month: "2026-11", type: "reactivated", priceCents: 20000 },
    { tenantId: 3, month: "2026-11", type: "price_changed", priceCents: 15000, previousPriceCents: 20000 },
    { tenantId: 9, month: "2025-01", type: "activated", priceCents: 1 },
  ],
  months,
);
assert.deepEqual(out, [
  { month: "2026-09", newCents: 40000, expansionCents: 0, contractionCents: 0, churnCents: 0, reactivationCents: 0, netCents: 40000 },
  { month: "2026-10", newCents: 0, expansionCents: 5000, contractionCents: 0, churnCents: 20000, reactivationCents: 0, netCents: -15000 },
  { month: "2026-11", newCents: 0, expansionCents: 0, contractionCents: 5000, churnCents: 0, reactivationCents: 20000, netCents: 15000 },
]);
console.log("mrr.test.ts: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/mrr.test.ts`
Expected: `Cannot find module './mrr'`.

- [ ] **Step 3: Write the module**

`app/src/lib/platform/mrr.ts`:

```ts
/**
 * MRR movements the way a finance person reads them: new, expansion,
 * contraction, churn, reactivation, net, per month. Pure: the caller turns
 * billing_events rows into MrrEvents. A month with no events is all zeros,
 * never missing, so a chart always has the same twelve columns.
 */
export interface MrrEvent {
  tenantId: number;
  month: string;
  type: "activated" | "reactivated" | "suspended" | "offboarded" | "cancelled" | "price_changed";
  priceCents: number;
  previousPriceCents?: number;
}

export interface MrrMovement {
  month: string;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnCents: number;
  reactivationCents: number;
  netCents: number;
}

export function mrrMovements(events: MrrEvent[], months: string[]): MrrMovement[] {
  const by = new Map(months.map((m) => [m, { month: m, newCents: 0, expansionCents: 0, contractionCents: 0, churnCents: 0, reactivationCents: 0, netCents: 0 }]));
  for (const e of events) {
    const row = by.get(e.month);
    if (!row) continue;
    switch (e.type) {
      case "activated": row.newCents += e.priceCents; break;
      case "reactivated": row.reactivationCents += e.priceCents; break;
      case "suspended":
      case "offboarded":
      case "cancelled": row.churnCents += e.priceCents; break;
      case "price_changed": {
        const delta = e.priceCents - (e.previousPriceCents ?? e.priceCents);
        if (delta > 0) row.expansionCents += delta;
        else row.contractionCents += -delta;
        break;
      }
    }
  }
  for (const row of by.values()) row.netCents = row.newCents + row.expansionCents + row.reactivationCents - row.contractionCents - row.churnCents;
  return months.map((m) => by.get(m)!);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/mrr.test.ts`
Expected: `mrr.test.ts: ok`.

- [ ] **Step 5: Log price changes, feed analytics**

In `app/src/lib/billing/engine.ts` find the function that writes `tenant_billing.price_override_cents` (`grep -n "price_override_cents" app/src/lib/billing/engine.ts`). Right after its UPDATE, add:

```ts
  logEvent(tenantId, "price_changed", { priceCents: cents ?? getMonthlyPriceCents(), previousPriceCents: previous ?? getMonthlyPriceCents() }, actor);
```

where `previous` is read before the update with `SELECT price_override_cents FROM tenant_billing WHERE tenant_id = ?`. (If the setter lives in `lib/platform/*` instead, put the same two lines there; `logEvent` is exported from `@/lib/billing/engine`.)

In `app/src/lib/platform/analytics.ts`, extend the `PlatformAnalytics` interface:

```ts
    /** New, expansion, contraction, churn, reactivation, net. Last 12 months. */
    mrrMovements: MrrMovement[];
    churnedByMonth: Array<{ month: string; count: number }>;
```

under `platform`, and under `gyms`:

```ts
    aiSpendByMonth: Array<{ month: string; cents: number }>;
    emailByMonth: Array<{ month: string; sent: number }>;
```

and in the function that builds the object, compute them (the file already has `last12Months(currentMonth)` and `dublinMonthOf`):

```ts
  const months = last12Months(currentMonth);
  const evRows = controlSqlite
    .prepare("SELECT tenant_id, type, detail, created_at FROM billing_events WHERE tenant_id IS NOT NULL AND type IN ('activated','reactivated','suspended','offboarded','cancelled','price_changed') AND created_at >= ?")
    .all(dublinMonthStartMs(months[0])) as Array<{ tenant_id: number; type: MrrEvent["type"]; detail: string | null; created_at: number }>;
  const price = getMonthlyPriceCents();
  const mrrEvents: MrrEvent[] = evRows.map((r) => {
    let d: { priceCents?: number; previousPriceCents?: number } = {};
    try { d = r.detail ? JSON.parse(r.detail) : {}; } catch { d = {}; }
    return { tenantId: r.tenant_id, month: dublinMonthOf(r.created_at), type: r.type, priceCents: d.priceCents ?? price, previousPriceCents: d.previousPriceCents };
  });
  const mrrMovementsOut = mrrMovements(mrrEvents, months);
  const churnedByMonth = months.map((month) => ({ month, count: mrrEvents.filter((e) => e.month === month && (e.type === "suspended" || e.type === "offboarded" || e.type === "cancelled")).length }));
  const aiRows = controlSqlite.prepare("SELECT yyyymm, SUM(cost_cents) AS cents FROM ai_usage GROUP BY yyyymm").all() as Array<{ yyyymm: string; cents: number }>;
  const aiSpendByMonth = months.map((month) => ({ month, cents: aiRows.find((r) => `${r.yyyymm.slice(0, 4)}-${r.yyyymm.slice(4, 6)}` === month)?.cents ?? 0 }));
  const emailRows = controlSqlite.prepare("SELECT yyyymm, SUM(sent_count) AS sent FROM email_usage GROUP BY yyyymm").all() as Array<{ yyyymm: string; sent: number }>;
  const emailByMonth = months.map((month) => ({ month, sent: emailRows.find((r) => `${r.yyyymm.slice(0, 4)}-${r.yyyymm.slice(4, 6)}` === month)?.sent ?? 0 }));
```

(`yyyymm` is stored as `YYYYMM`; confirm with `sqlite3 app/data/control.db "select yyyymm from ai_usage limit 1"`. If it is already `YYYY-MM`, compare directly.) Add `mrrMovements: mrrMovementsOut, churnedByMonth` to the `platform` object and `aiSpendByMonth, emailByMonth` to `gyms`, with `import { mrrMovements, type MrrEvent, type MrrMovement } from "./mrr";`.

- [ ] **Step 6: Typecheck, run the analytics test, commit**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/platform/analytics.test.ts`
Expected: both clean (update the analytics test's expected shape if it asserts exact keys).

```bash
git add app/src/lib/platform/mrr.ts app/src/lib/platform/mrr.test.ts app/src/lib/platform/analytics.ts app/src/lib/billing/engine.ts
git commit -m "feat(platform): MRR movements, churn, AI spend and email volume by month in analytics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Charts (console)

**Files:**
- Create: `admin/src/lib/chart.ts`, `admin/src/lib/chart.test.ts`
- Create: `admin/src/components/charts/LineChart.tsx`, `admin/src/components/charts/BarChart.tsx`
- Modify: `admin/src/app/globals.css`

**Interfaces:**
- Pure: `niceTicks(max: number, count?: number): number[]`, `scale(domainMax: number, range: number): (v: number) => number`.
- `LineChart({ series: { label: string; values: number[]; accent?: boolean }[]; labels: string[]; height?: number; format?: (v: number) => string; title: string })`
- `BarChart({ groups: { label: string; up: number; down: number }[]; height?: number; format?: (v: number) => string; title: string })` (MRR: stacked up/down per month with a net dot).

- [ ] **Step 1: Write the failing test**

`admin/src/lib/chart.test.ts`:

```ts
// Run: npm test -- src/lib/chart.test.ts
import assert from "node:assert/strict";

import { niceTicks, scale } from "./chart";

assert.deepEqual(niceTicks(0), [0]);
assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
assert.deepEqual(niceTicks(950), [0, 250, 500, 750, 1000]);
assert.deepEqual(niceTicks(12000, 3), [0, 5000, 10000, 15000]);
const s = scale(100, 200);
assert.equal(s(0), 0);
assert.equal(s(50), 100);
assert.equal(scale(0, 200)(5), 0, "a zero domain draws flat, never NaN");
console.log("chart.test.ts: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd admin && npm test -- src/lib/chart.test.ts`
Expected: `Cannot find module './chart'`.

- [ ] **Step 3: The pure helpers**

`admin/src/lib/chart.ts`:

```ts
/** Round tick values that cover [0, max] in about `count` steps: 1, 2, 2.5, 5 × 10^n. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** Linear 0..domainMax → 0..range. A zero domain maps everything to 0. */
export function scale(domainMax: number, range: number): (v: number) => number {
  if (domainMax <= 0) return () => 0;
  return (v) => (v / domainMax) * range;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd admin && npm test -- src/lib/chart.test.ts`
Expected: `chart.test.ts: ok`.

- [ ] **Step 5: The components**

`admin/src/components/charts/LineChart.tsx`:

```tsx
"use client";

import { useId, useState } from "react";

import { niceTicks, scale } from "@/lib/chart";

/**
 * Inline SVG line chart. One accent series (the metal gradient already used
 * by the dashboard sparkline), the rest in grey. Axes, round ticks, and a
 * hover readout. Refuses to draw when every value is zero: a flat line
 * along nothing is a picture of nothing, so it says so instead.
 */
export function LineChart({
  title,
  series,
  labels,
  height = 180,
  format = (v) => String(v),
}: {
  title: string;
  series: { label: string; values: number[]; accent?: boolean }[];
  labels: string[];
  height?: number;
  format?: (v: number) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  if (max === 0) return <div className="chart chart--empty"><span className="chart-title">{title}</span><span>No movement yet.</span></div>;
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = scale(top, innerH);
  const x = (i: number) => (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * innerW);
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${pad.l + x(i)},${pad.t + innerH - y(v)}`).join(" ");

  return (
    <figure className="chart" aria-label={title}>
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-accent`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.5" stopColor="#9fb0c4" />
            <stop offset="1" stopColor="#f4f8ff" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={pad.t + innerH - y(t)} y2={pad.t + innerH - y(t)} className="chart-grid" />
            <text x={pad.l - 8} y={pad.t + innerH - y(t) + 3.5} className="chart-tick" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1) && (
          <text key={l + i} x={pad.l + x(i)} y={height - 8} className="chart-tick" textAnchor="middle">{l}</text>
        ))}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.accent ? `url(#${id}-accent)` : "rgba(244,245,247,0.28)"} strokeWidth={s.accent ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {labels.map((_, i) => (
          <rect key={i} x={pad.l + x(i) - innerW / labels.length / 2} y={pad.t} width={innerW / labels.length} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && (
          <g>
            <line x1={pad.l + x(hover)} x2={pad.l + x(hover)} y1={pad.t} y2={pad.t + innerH} className="chart-cursor" />
            {series.map((s) => (
              <circle key={s.label} cx={pad.l + x(hover)} cy={pad.t + innerH - y(s.values[hover] ?? 0)} r={3.5} fill={s.accent ? "#ffffff" : "rgba(244,245,247,0.6)"} />
            ))}
          </g>
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label} className={s.accent ? "is-accent" : undefined}>
            <i aria-hidden /> {s.label}
            {hover !== null && <strong> {format(s.values[hover] ?? 0)}</strong>}
          </span>
        ))}
        {hover !== null && <span className="chart-hover-label">{labels[hover]}</span>}
      </div>
    </figure>
  );
}
```

`admin/src/components/charts/BarChart.tsx`:

```tsx
"use client";

import { useState } from "react";

import { niceTicks, scale } from "@/lib/chart";

/** Up (gains) above the line in the accent, down (losses) below in grey, a dot for net. For MRR movements. */
export function BarChart({
  title,
  groups,
  height = 200,
  format = (v) => String(v),
}: {
  title: string;
  groups: { label: string; up: number; down: number; net: number }[];
  height?: number;
  format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const pad = { l: 50, r: 12, t: 12, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = Math.max(0, ...groups.flatMap((g) => [g.up, g.down, Math.abs(g.net)]));
  if (max === 0) return <div className="chart chart--empty"><span className="chart-title">{title}</span><span>No movement yet.</span></div>;
  const top = niceTicks(max, 2).slice(-1)[0];
  const half = innerH / 2;
  const y = scale(top, half);
  const slot = innerW / groups.length;
  const bar = Math.min(28, slot * 0.5);
  const mid = pad.t + half;
  return (
    <figure className="chart" aria-label={title}>
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" onMouseLeave={() => setHover(null)}>
        {[-top, -top / 2, 0, top / 2, top].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={mid - y(t)} y2={mid - y(t)} className={t === 0 ? "chart-axis" : "chart-grid"} />
            <text x={pad.l - 8} y={mid - y(t) + 3.5} className="chart-tick" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {groups.map((g, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={g.label} onMouseEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={innerH} fill="transparent" />
              <rect x={cx - bar / 2} y={mid - y(g.up)} width={bar} height={y(g.up)} fill="#9fb0c4" rx={2} />
              <rect x={cx - bar / 2} y={mid} width={bar} height={y(g.down)} fill="rgba(244,245,247,0.22)" rx={2} />
              <circle cx={cx} cy={mid - y(g.net)} r={3} fill="#ffffff" />
              <text x={cx} y={height - 8} className="chart-tick" textAnchor="middle">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="is-accent"><i aria-hidden /> Gained{hover !== null && <strong> {format(groups[hover].up)}</strong>}</span>
        <span><i aria-hidden /> Lost{hover !== null && <strong> {format(groups[hover].down)}</strong>}</span>
        <span>Net{hover !== null && <strong> {format(groups[hover].net)}</strong>}</span>
        {hover !== null && <span className="chart-hover-label">{groups[hover].label}</span>}
      </div>
    </figure>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
/* ── Charts (components/charts/*) ───────────────────────────────────────── */
.chart { margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.chart svg { width: 100%; height: auto; display: block; }
.chart-title { font-family: var(--font-mono), ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-tertiary); }
.chart--empty { gap: 6px; color: var(--text-secondary); font-size: 13px; padding: 12px 0 18px; }
.chart-grid { stroke: var(--grid); }
.chart-axis { stroke: var(--hairline-strong); }
.chart-cursor { stroke: var(--hairline-strong); stroke-dasharray: 2 3; }
.chart-tick { fill: var(--text-tertiary); font-family: var(--font-mono), ui-monospace, monospace; font-size: 10px; }
.chart-legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--text-secondary); }
.chart-legend i { display: inline-block; width: 10px; height: 2px; background: rgba(244,245,247,0.35); vertical-align: middle; margin-right: 2px; }
.chart-legend .is-accent i { background: #9fb0c4; }
.chart-legend strong { color: var(--text-primary); font-family: var(--font-mono), ui-monospace, monospace; font-weight: 500; font-variant-numeric: tabular-nums; }
.chart-hover-label { margin-left: auto; color: var(--text-tertiary); }
.chart-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px 40px; }
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd admin && npx tsc --noEmit -p .`

```bash
git add admin/src/lib/chart.ts admin/src/lib/chart.test.ts admin/src/components/charts admin/src/app/globals.css
git commit -m "feat(console): inline SVG line and bar charts with ticks, hover and an honest empty state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The inbox (console)

**Files:**
- Modify: `admin/src/lib/types.ts`
- Create: `admin/src/app/(console)/inbox/page.tsx`, `admin/src/app/(console)/inbox/actions.ts`, `admin/src/components/inbox/AlertList.tsx`
- Modify: `admin/src/components/Shell.tsx`, `admin/src/app/(console)/layout.tsx`, `admin/src/lib/shortcuts.ts`, `admin/src/lib/shortcuts.test.ts`, `admin/src/app/globals.css`

**Interfaces:**
- Types added to `admin/src/lib/types.ts`:

```ts
export interface PlatformAlert { id: number; tenantId: number | null; tenantName: string | null; key: string; level: "warn" | "bad"; title: string; detail: string | null; href: string | null; openedAt: number; lastSeenAt: number; resolvedAt: number | null; acknowledgedAt: number | null; acknowledgedBy: number | null; snoozedUntil: number | null; assignedTo: number | null }
export interface AlertsResponse { alerts: PlatformAlert[]; counts: { bad: number; warn: number } }
```

- `alertAction(body: { id: number; op: "ack" | "unack" } | { id: number; op: "snooze"; until: number } | { id: number; op: "assign"; userId: number | null })`.
- `Shell` prop `inboxCount: { bad: number; warn: number }`. Shortcut `g i` → `/inbox`.

- [ ] **Step 1: Shortcut test first**

Add to `admin/src/lib/shortcuts.test.ts`: `assert.deepEqual(resolveShortcut("g", "i"), { kind: "go", href: "/inbox" });` and `assert.deepEqual(resolveShortcut("g", "j"), { kind: "go", href: "/jobs" });`. Run it: fails. Add `{ keys: "g i", label: "Inbox", href: "/inbox" }` and `{ keys: "g j", label: "Jobs", href: "/jobs" }` to `SHORTCUTS` in `lib/shortcuts.ts` and to `STATIC_COMMANDS` in `lib/palette.ts` (`{ title: "Inbox", hint: "g i", href: "/inbox" }`, `{ title: "Jobs", hint: "g j", href: "/jobs" }`). Run again: passes.

- [ ] **Step 2: Action and list**

`admin/src/app/(console)/inbox/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import { bust } from "@/lib/revalidate";

export type AlertOpBody =
  | { id: number; op: "ack" | "unack" }
  | { id: number; op: "snooze"; until: number }
  | { id: number; op: "assign"; userId: number | null };

export async function alertAction(body: AlertOpBody): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api("/alerts", { method: "POST", body });
    bust();
    revalidatePath("/inbox");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
```

`admin/src/components/inbox/AlertList.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, OctagonAlert, UserRound } from "lucide-react";

import { notify } from "@/lib/toast";
import { alertAction } from "@/app/(console)/inbox/actions";
import type { PlatformAlert, PlatformStaffRow } from "@/lib/types";

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1 day";
  return `${d} days`;
}

/** Ranked list: bad, then warn; unacknowledged before acknowledged; oldest first. The server already orders it. */
export function AlertList({ alerts, staff, meId }: { alerts: PlatformAlert[]; staff: PlatformStaffRow[]; meId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (body: Parameters<typeof alertAction>[0], done: string) =>
    start(async () => {
      const r = await alertAction(body);
      if (r.ok) { notify.ok(done); router.refresh(); } else notify.fail(r.error);
    });
  if (alerts.length === 0) return <p className="inbox-empty">Nothing needs you. The next sweep runs on the hour.</p>;
  return (
    <ul className="inbox">
      {alerts.map((a) => {
        const Icon = a.level === "bad" ? OctagonAlert : AlertTriangle;
        const assignee = staff.find((s) => s.userId === a.assignedTo);
        return (
          <li key={a.id} className={`inbox-row is-${a.level}${a.acknowledgedAt ? " is-acked" : ""}`}>
            <Icon size={16} strokeWidth={1.75} className="inbox-icon" aria-label={a.level === "bad" ? "Needs action" : "Watch"} />
            <div className="inbox-main">
              <Link href={a.href ?? "/"} className="inbox-title">{a.title}</Link>
              <div className="inbox-meta">
                {a.tenantName && <Link href={`/gyms/${a.tenantId}`}>{a.tenantName}</Link>}
                <span>open {ago(a.openedAt)}</span>
                {a.acknowledgedAt && <span>acknowledged</span>}
                {assignee && <span><UserRound size={11} aria-hidden /> {assignee.name ?? assignee.email}</span>}
              </div>
            </div>
            <div className="inbox-actions">
              {a.acknowledgedAt ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "unack" }, "Reopened")}>Reopen</button>
              ) : (
                <button type="button" className="btn btn--secondary btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "ack" }, "Acknowledged")}><Check size={13} aria-hidden /> Acknowledge</button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "snooze", until: Date.now() + 86400000 }, "Snoozed for a day")}><Clock size={13} aria-hidden /> 1d</button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "snooze", until: Date.now() + 7 * 86400000 }, "Snoozed for a week")}>7d</button>
              <select
                className="input"
                aria-label="Assign to"
                value={a.assignedTo ?? ""}
                disabled={pending}
                onChange={(e) => run({ id: a.id, op: "assign", userId: e.target.value ? Number(e.target.value) : null }, e.target.value ? "Assigned" : "Unassigned")}
                style={{ minHeight: 32, padding: "0 36px 0 10px", fontSize: 12.5, width: "auto" }}
              >
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.userId} value={s.userId}>{s.userId === meId ? "Me" : s.name ?? s.email}</option>)}
              </select>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

`admin/src/app/(console)/inbox/page.tsx`:

```tsx
import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertList } from "@/components/inbox/AlertList";
import type { AlertsResponse, StaffResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** What needs a platform operator, across every business, ranked. */
export default async function InboxPage(props: { searchParams: Promise<{ snoozed?: string; mine?: string }> }) {
  const sp = await props.searchParams;
  const me = await requireAdminSession();
  const [{ alerts, counts }, staff] = await Promise.all([
    api<AlertsResponse>(`/alerts${sp.snoozed ? "?snoozed=1" : ""}`),
    api<StaffResponse>("/staff", { revalidate: 30, tags: ["fleet"] }),
  ]);
  const shown = sp.mine ? alerts.filter((a) => a.assignedTo === me.userId) : alerts;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        eyebrow="Fleet"
        title="Inbox"
        sub={counts.bad + counts.warn === 0 ? "Nothing open." : `${counts.bad} ${counts.bad === 1 ? "needs" : "need"} action, ${counts.warn} to watch. Checked every hour; serious ones are emailed as they open.`}
        actions={
          <form method="GET" className="toolbar">
            <label className="check"><input type="checkbox" name="mine" value="1" defaultChecked={Boolean(sp.mine)} onChange={undefined} /> Mine</label>
            <label className="check"><input type="checkbox" name="snoozed" value="1" defaultChecked={Boolean(sp.snoozed)} /> Show snoozed</label>
            <button className="btn btn--secondary btn--sm" type="submit">Apply</button>
          </form>
        }
      />
      <Card style={{ padding: "8px 26px" }}>
        <AlertList alerts={shown} staff={staff.staff} meId={me.userId} />
      </Card>
    </div>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
/* ── Inbox (components/inbox/AlertList.tsx) ─────────────────────────────── */
.inbox { list-style: none; margin: 0; padding: 0; }
.inbox-row { display: flex; align-items: flex-start; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--grid); }
.inbox-row:last-child { border-bottom: 0; }
.inbox-row.is-acked { opacity: 0.6; }
.inbox-icon { flex: 0 0 auto; margin-top: 2px; color: var(--amber); }
.is-bad .inbox-icon { color: var(--red); }
.inbox-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.inbox-title { font-size: 14px; color: var(--text-primary); }
.inbox-title:hover { text-decoration: underline; }
.inbox-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--text-tertiary); }
.inbox-meta a { color: var(--text-secondary); }
.inbox-meta span { display: inline-flex; align-items: center; gap: 4px; }
.inbox-actions { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.inbox-empty { margin: 14px 0; color: var(--text-secondary); font-size: 13.5px; }
.check { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text-secondary); }
.nav-badge { margin-left: auto; min-width: 20px; padding: 1px 6px; border-radius: 999px; font-family: var(--font-mono), ui-monospace, monospace; font-size: 10.5px; text-align: center; background: var(--surface-3); color: var(--text-secondary); }
.nav-badge.is-bad { background: rgba(240, 128, 154, 0.18); color: var(--red); }
```

- [ ] **Step 3: Nav and badge**

In `admin/src/app/(console)/layout.tsx` fetch the counts alongside views and pass `inboxCount`:

```tsx
  let inboxCount = { bad: 0, warn: 0 };
  try {
    inboxCount = (await api<{ counts: { bad: number; warn: number } }>("/alerts", { revalidate: 60, tags: ["fleet"] })).counts;
  } catch {
    inboxCount = { bad: 0, warn: 0 };
  }
```

and `<Shell user={user} views={views} inboxCount={inboxCount}>`.

In `admin/src/components/Shell.tsx`: add `Inbox` (lucide) and `ListChecks` icons; add to `NAV_GROUPS` Fleet group, first: `{ href: "/inbox", label: "Inbox", icon: Inbox }`, and to the Operate group after Audit log: `{ href: "/jobs", label: "Jobs", icon: ListChecks }`. Add the prop `inboxCount: { bad: number; warn: number }`. In the link render, after `<span>{item.label}</span>`:

```tsx
                    {item.href === "/inbox" && inboxCount.bad + inboxCount.warn > 0 && (
                      <span className={cn("nav-badge", inboxCount.bad > 0 && "is-bad")}>{inboxCount.bad + inboxCount.warn}</span>
                    )}
```

- [ ] **Step 4: Check and commit**

Run: `cd admin && npx tsc --noEmit -p . && npm test 2>&1 | tail -1`

```bash
git add admin/src/lib/types.ts admin/src/lib/shortcuts.ts admin/src/lib/shortcuts.test.ts admin/src/lib/palette.ts "admin/src/app/(console)/inbox" admin/src/components/inbox "admin/src/app/(console)/layout.tsx" admin/src/components/Shell.tsx admin/src/app/globals.css
git commit -m "feat(console): the inbox, one ranked list of what needs an operator, with a count in the sidebar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard: inbox panel, trends, MRR movements (console)

**Files:**
- Modify: `admin/src/lib/types.ts` (`PlatformAnalytics` additions)
- Modify: `admin/src/app/(console)/page.tsx`

- [ ] **Step 1: Types**

In `admin/src/lib/types.ts` `PlatformAnalytics`, add under `platform`:

```ts
    mrrMovements: Array<{ month: string; newCents: number; expansionCents: number; contractionCents: number; churnCents: number; reactivationCents: number; netCents: number }>;
    churnedByMonth: Array<{ month: string; count: number }>;
```

and under `gyms`:

```ts
    aiSpendByMonth: Array<{ month: string; cents: number }>;
    emailByMonth: Array<{ month: string; sent: number }>;
```

- [ ] **Step 2: The page**

In `admin/src/app/(console)/page.tsx`:
- Fetch alerts too: `const [data, { alerts, counts }] = await Promise.all([api<PlatformAnalytics>("/analytics", { revalidate: 30, tags: ["fleet"] }), api<AlertsResponse>("/alerts", { revalidate: 60, tags: ["fleet"] })]);`
- Replace the hero sentence's `needsAttention` count with `counts.bad + counts.warn`, and after the `board-meters` block insert the inbox panel:

```tsx
      <section className="cluster">
        <h2>
          Needs you
          <Link href="/inbox" className="fleet-count">Open the inbox</Link>
        </h2>
        {alerts.length === 0 ? (
          <p style={{ margin: "6px 0 0", color: "var(--text-secondary)", fontSize: 13.5 }}>Nothing open.</p>
        ) : (
          <ul className="inbox">
            {alerts.slice(0, 5).map((a) => (
              <li key={a.id} className={`inbox-row is-${a.level}`} style={{ padding: "12px 0" }}>
                <span className="inbox-icon" aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: a.level === "bad" ? "var(--red)" : "var(--amber)", marginTop: 7 }} />
                <div className="inbox-main">
                  <Link href={a.href ?? "/inbox"} className="inbox-title">{a.title}</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
```

- Replace the `board-trends` section (the sparkline + "subscription revenue collected" pair) with:

```tsx
      <section className="board-trends">
        <h2>Twelve months</h2>
        <div className="chart-grid-2">
          <LineChart title="Businesses on the platform" labels={growthLabels} series={[{ label: "Total", values: growth, accent: true }]} />
          <LineChart title="Subscription revenue collected" labels={growthLabels} series={[{ label: "Collected", values: collected.map((c) => c / 100), accent: true }]} format={(v) => `€${Math.round(v)}`} />
          <LineChart title="AI spend across businesses" labels={growthLabels} series={[{ label: "Spend", values: gyms.aiSpendByMonth.map((p) => p.cents / 100), accent: true }]} format={(v) => `€${Math.round(v)}`} />
          <LineChart title="Emails sent" labels={growthLabels} series={[{ label: "Sent", values: gyms.emailByMonth.map((p) => p.sent), accent: true }]} />
        </div>
        <BarChart
          title="MRR movements"
          groups={platform.mrrMovements.map((m) => ({ label: fmtMonthShort(m.month), up: (m.newCents + m.expansionCents + m.reactivationCents) / 100, down: (m.churnCents + m.contractionCents) / 100, net: m.netCents / 100 }))}
          format={(v) => `€${Math.round(v)}`}
        />
      </section>
```

with imports `import { LineChart } from "@/components/charts/LineChart";`, `import { BarChart } from "@/components/charts/BarChart";` and `AlertsResponse` from types. Remove the now-unused `Sparkline` import if nothing else uses it (keep `ShareBar`).

- [ ] **Step 3: Screenshot, check, commit**

Run: `cd admin && npx tsc --noEmit -p . && ADMIN_SESSION=$RAW node scripts/screens.mjs /tmp/screens dash`
Expected: the hero, meters, a "Needs you" list, the fleet list, four charts in a two-by-two grid (flat ones say "No movement yet."), the MRR bars.

```bash
git add admin/src/lib/types.ts "admin/src/app/(console)/page.tsx"
git commit -m "feat(console): dashboard leads with what needs you, then twelve months of trends and MRR movements

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Health history on the business Health tab (console)

**Files:**
- Modify: `admin/src/lib/types.ts` (`TenantHealth` gains `history`, `openAlerts`, `alertHistory`; `HealthAlert` gains `key`)
- Modify: `admin/src/app/(console)/gyms/[id]/health/page.tsx`, `admin/src/components/health/HealthPanel.tsx`

- [ ] **Step 1: Types and fetch**

In `admin/src/lib/types.ts`: `HealthAlert` becomes `{ key: string; level: "warn" | "bad"; message: string }`; add to `TenantHealth`:

```ts
  history: Array<{ at: number; dbBytes: number; walBytes: number; queueDue: number; queueFailed: number; stuck: number; alertsBad: number; alertsWarn: number }>;
  openAlerts: PlatformAlert[];
  alertHistory: PlatformAlert[];
```

In `health/page.tsx` change the fetch to `api<TenantHealth>(\`/tenants/${id}/health?history=30\`)`.

- [ ] **Step 2: Graphs in the panel**

In `HealthPanel.tsx` import `LineChart` and `bytes`, and add a card after the alerts card:

```tsx
      <Card>
        <h2 className="card-title" style={{ margin: "0 0 4px" }}>Thirty days</h2>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--text-secondary)" }}>One point an hour. A queue that only grows, or a database that jumps, shows here before anyone reports it.</p>
        {data.history.length < 2 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>History starts after the first two snapshots.</p>
        ) : (
          <div className="chart-grid-2">
            <LineChart title="Database size" labels={labels} series={[{ label: "Database", values: data.history.map((h) => h.dbBytes / 1048576), accent: true }, { label: "WAL", values: data.history.map((h) => h.walBytes / 1048576) }]} format={(v) => `${v.toFixed(1)} MB`} />
            <LineChart title="Queued work" labels={labels} series={[{ label: "Due", values: data.history.map((h) => h.queueDue), accent: true }, { label: "Failed", values: data.history.map((h) => h.queueFailed) }]} />
            <LineChart title="Open alerts" labels={labels} series={[{ label: "Needs action", values: data.history.map((h) => h.alertsBad), accent: true }, { label: "Watch", values: data.history.map((h) => h.alertsWarn) }]} />
          </div>
        )}
      </Card>
```

with, inside the component, `const labels = data.history.map((h) => new Date(h.at).toLocaleDateString("en-IE", { day: "numeric", month: "short" }));`.

And an alert history card:

```tsx
      <Card>
        <h2 className="card-title" style={{ margin: "0 0 12px" }}>Alert history</h2>
        {data.alertHistory.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>No alerts recorded for this business.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Opened</th><th>Alert</th><th>Resolved</th></tr></thead>
            <tbody>
              {data.alertHistory.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(a.openedAt).toLocaleDateString("en-IE")}</td>
                  <td style={{ color: a.level === "bad" ? "var(--red)" : undefined }}>{a.title}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)" }}>{a.resolvedAt ? new Date(a.resolvedAt).toLocaleDateString("en-IE") : "open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
```

- [ ] **Step 3: Check and commit**

Run: `cd admin && npx tsc --noEmit -p .`

```bash
git add admin/src/lib/types.ts "admin/src/app/(console)/gyms/[id]/health/page.tsx" admin/src/components/health/HealthPanel.tsx
git commit -m "feat(console): thirty days of health per business, and its alert history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Jobs page (console)

**Files:**
- Modify: `admin/src/lib/types.ts`
- Create: `admin/src/app/(console)/jobs/page.tsx`, `admin/src/components/jobs/RunStrip.tsx`
- Modify: `admin/src/app/globals.css`

- [ ] **Step 1: Types**

```ts
export interface JobRun { id: number; key: string; label: string; startedAt: number; finishedAt: number | null; ok: boolean | null; error: string | null; durationMs: number | null; detail: unknown }
export interface JobsResponse { latest: JobRun[]; history: JobRun[] }
```

- [ ] **Step 2: Strip and page**

`admin/src/components/jobs/RunStrip.tsx`:

```tsx
import type { JobRun } from "@/lib/types";

/** Thirty cells, oldest left: green ok, red failed, grey running. Title carries the detail. */
export function RunStrip({ runs }: { runs: JobRun[] }) {
  const cells = [...runs].reverse().slice(-30);
  return (
    <span className="runstrip" aria-label={`${cells.length} recent runs`}>
      {cells.map((r) => (
        <i
          key={r.id}
          className={r.ok === true ? "is-ok" : r.ok === false ? "is-fail" : "is-run"}
          title={`${new Date(r.startedAt).toLocaleString("en-IE")}: ${r.ok === true ? `ok in ${r.durationMs} ms` : r.ok === false ? r.error ?? "failed" : "running"}`}
        />
      ))}
    </span>
  );
}
```

`admin/src/app/(console)/jobs/page.tsx`:

```tsx
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { RunStrip } from "@/components/jobs/RunStrip";
import type { JobsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Every background job: last run, outcome, duration, and its recent history. */
export default async function JobsPage(props: { searchParams: Promise<{ key?: string }> }) {
  const sp = await props.searchParams;
  const { latest } = await api<JobsResponse>("/jobs");
  const histories = await Promise.all(latest.map((j) => api<JobsResponse>(`/jobs?key=${encodeURIComponent(j.key)}&limit=30`).then((r) => [j.key, r.history] as const)));
  const byKey = new Map(histories);
  const open = sp.key ? byKey.get(sp.key) ?? [] : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Operate" title="Jobs" sub="The platform's background work. A failed run opens an alert in the inbox." />
      <Card style={{ padding: "20px 26px 16px" }}>
        {latest.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No job has run yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Job</th><th>Last run</th><th>Outcome</th><th style={{ textAlign: "right" }}>Took</th><th>Recent</th></tr></thead>
            <tbody>
              {latest.map((j) => (
                <tr key={j.key}>
                  <td><a href={`/jobs?key=${encodeURIComponent(j.key)}`}>{j.label}</a><div style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>{j.key}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>{when(j.startedAt)}</td>
                  <td>{j.ok === true ? <span className="chip active">ok</span> : j.ok === false ? <span className="chip suspended" title={j.error ?? ""}>failed</span> : <span className="chip">running</span>}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{j.durationMs === null ? "—" : j.durationMs < 1000 ? `${j.durationMs} ms` : `${(j.durationMs / 1000).toFixed(1)} s`}</td>
                  <td><RunStrip runs={byKey.get(j.key) ?? []} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {sp.key && (
        <Card style={{ padding: "20px 26px 16px" }}>
          <h2 className="card-title" style={{ margin: "0 0 12px" }}>{latest.find((j) => j.key === sp.key)?.label ?? sp.key}: last {open.length} runs</h2>
          <table className="tbl">
            <thead><tr><th>Started</th><th>Outcome</th><th style={{ textAlign: "right" }}>Took</th><th>Detail</th></tr></thead>
            <tbody>
              {open.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(r.startedAt)}</td>
                  <td style={{ color: r.ok === false ? "var(--red)" : undefined }}>{r.ok === true ? "ok" : r.ok === false ? r.error : "running"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.durationMs ?? "—"} ms</td>
                  <td><code style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 12, color: "var(--text-secondary)" }}>{r.detail ? JSON.stringify(r.detail) : ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
.runstrip { display: inline-flex; gap: 2px; }
.runstrip i { width: 6px; height: 16px; border-radius: 2px; background: var(--surface-3); }
.runstrip i.is-ok { background: rgba(63, 185, 80, 0.55); }
.runstrip i.is-fail { background: var(--red); }
```

- [ ] **Step 3: Check and commit**

Run: `cd admin && npx tsc --noEmit -p .`

```bash
git add admin/src/lib/types.ts "admin/src/app/(console)/jobs" admin/src/components/jobs admin/src/app/globals.css
git commit -m "feat(console): a Jobs page with every background job's last run and history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Notification preferences on Settings (console)

**Files:**
- Modify: `admin/src/lib/types.ts` (`StaffResponse.you.notify`)
- Modify: `admin/src/app/(console)/settings/actions.ts`, `admin/src/app/(console)/settings/page.tsx`

- [ ] **Step 1: Type and action**

`StaffResponse.you` becomes `{ userId: number; role: PlatformRole; notify: { instant: boolean; digest: boolean } }`.

Append to `settings/actions.ts`:

```ts
/** The signed-in staff member's own alert emails. */
export async function saveNotifyPrefs(formData: FormData): Promise<void> {
  const notify = { instant: formData.get("instant") === "on", digest: formData.get("digest") === "on" };
  try {
    await api("/staff", { method: "PUT", body: { notify } });
  } catch (err) {
    redirect(`/settings?error=${encodeURIComponent(err instanceof ApiError ? err.message : "Could not save that.")}`);
  }
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
```

- [ ] **Step 2: The card**

In `settings/page.tsx` fetch `const staff = await api<StaffResponse>("/staff");` and after the existing settings form add:

```tsx
      <form action={saveNotifyPrefs} className="glass" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 className="card-title" style={{ margin: 0 }}>Alert emails to you</h2>
        <label className="check"><input type="checkbox" name="instant" defaultChecked={staff.you.notify.instant} /> The moment a serious alert opens</label>
        <label className="check"><input type="checkbox" name="digest" defaultChecked={staff.you.notify.digest} /> A morning digest at 8am of everything still open</label>
        <div><button className="btn btn--primary btn--md" type="submit">Save</button></div>
      </form>
```

- [ ] **Step 3: Check and commit**

Run: `cd admin && npx tsc --noEmit -p .`

```bash
git add admin/src/lib/types.ts "admin/src/app/(console)/settings"
git commit -m "feat(console): each staff member chooses instant alert emails and the morning digest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Deploy both apps

- [ ] **Step 1: App**

```bash
cd app && npx tsc --noEmit -p . && npm test 2>&1 | tail -1 && rm -rf .next && npx next build 2>&1 | tail -2
git push origin main && railway up --detach
```

Set `CONSOLE_URL=https://admin.adonisagent.ie` on the app's Railway service (`railway variables --set CONSOLE_URL=https://admin.adonisagent.ie`) so emails link to the console. Wait for `SUCCESS`; `curl -s https://app.adonisagent.ie/api/health`.

- [ ] **Step 2: Console**

```bash
cd admin && npx tsc --noEmit -p . && npm test 2>&1 | tail -1 && npx next build 2>&1 | tail -2
railway up --detach
```

- [ ] **Step 3: Verify**

Inbox shows the open alerts with a count in the sidebar (on a healthy fleet it may be empty; the Businesses page's "No billing" business should show `billing:pending_long`). Acknowledge one; the audit log records `alert.ack`. Jobs page lists `health_snapshot`, `daily_automations`, `nightly_backup` once each has run. Dashboard shows charts. A business's Health tab shows the thirty-day graphs after a few hours of snapshots.

---

## Self-review

**Spec coverage.** Alerts inbox across billing, integrations, AI cap, failed jobs, database health, with ack/snooze/assign, as the dashboard's top panel: Tasks 1, 2, 6, 7. Notifications (instant + daily digest, per-staff opt-out): Tasks 3, 10. WhatsApp to staff is not built: the platform has no phone number of its own (WhatsApp is per business via Whapi); email is the channel. Health history as 30-day graphs: Tasks 1 (data already from Tier 1), 2, 5, 8. Real charts (MRR, collected, businesses, AI spend, email volume): Tasks 4, 5, 7. MRR movements: Tasks 4, 7. Job runs with duration/outcome and failed-run alerts: Tier 1 recorder + Tasks 1, 2, 9.

**Placeholders.** Task 4 Step 5 points to the price-override setter by grep because its file was not read for this plan; the code to add is given in full. Task 4 Step 5 also tells the implementer to confirm the `yyyymm` format and gives both branches.

**Type consistency.** `AlertCandidate` (Tier 1) is what `alertSources.ts` produces and `syncPlatformAlerts` consumes. `PlatformAlertRow` (app, Task 1) and `PlatformAlert` (admin, Task 6) have identical fields. `AlertOp` (app) matches `AlertOpBody` minus `id` (admin). `JobRunRow` (Tier 1) and `JobRun` (admin, Task 9) match. `MrrMovement` fields are the same in app (Task 4) and admin (Task 7). `NotifyPrefs` (Task 3) is the `you.notify` shape (Task 10).
