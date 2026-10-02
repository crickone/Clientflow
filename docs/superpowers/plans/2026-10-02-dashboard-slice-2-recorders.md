# Customisable Dashboard — Slice 2 (Event Recorders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start recording the four kinds of events the in-depth dashboard presets need — lead stage moves, website page views, Mailgun email events, and appointment-cancelled / membership-ended dates — so the data accumulates from deploy day.

**Architecture:** Each recorder is append-only and never changes existing behaviour: a recorder failure is logged and swallowed, never failing the user's action. New tables and columns are additive in `ensureTenantTables`; the one-off appointment backfill is a versioned migration. Each recorder's start date is stamped once per tenant as a settings key (`recorder_started:<key>`) so later widgets can say "Collecting since". Page views are first-party, cookieless, aggregated per day, keyed on a daily-rotating salted hash that is purged once the day closes.

**Tech Stack:** Next.js 14 App Router, drizzle-orm over better-sqlite3 (one DB per tenant, ambient `db` proxy, `runWithTenant` for background work), plain `node:assert` test scripts run by `npm test -- <path>`.

Spec: `docs/superpowers/specs/2026-10-02-customisable-dashboard-design.md` section 2. Slice 1 is live. Dashboard widgets that READ this data are slices 3 and 4, not this plan.

## Global Constraints

- NO EMOJIS anywhere (code, comments, UI, commits).
- All work in `app/`. Run commands from `/Users/truep/Desktop/Clients/Renova/app`.
- Recorders are append-only, never change existing behaviour, and a recorder failure is logged (`console.error("[recorder:<key>] ...", err)`) and swallowed — it must never fail or roll back the action that triggered it.
- New tables and nullable columns go in `ensureTenantTables` (`src/lib/db/tenant.ts`); columns via the existing PRAGMA-guarded `addCol` pattern. One-off data backfills go in a versioned migration (`src/lib/db/migrations/index.ts`, `TENANT_MIGRATIONS`).
- Recorder keys (exact strings): `stage_history`, `page_views`, `email_events`, `status_dates`. Start stamp settings key: `recorder_started:<key>`, value a JSON string ISO timestamp, written with `INSERT OR IGNORE` so it is set once and never moves.
- Stage event `actor` values (exact): `user`, `agent`, `automation`, `system`.
- Page views: no IP address and no cookie are stored. Unique visitor = sha256 of (secret, day, siteId, IP, user agent); hashes are kept only for the current UTC day and purged after. Known bots dropped. Only hits whose host resolves via a verified `site_domains` row (`resolvedVia === "host"`) are counted; dev `/site/<slug>` previews are not counted. Studio edit (`cmsedit`) and draft previews do not send the beacon.
- Public endpoint `/api/site-events` always answers 204, rate-limited per IP (120 per minute), added to `PUBLIC_API_PREFIXES` in `src/middleware.ts`.
- Before deploy: `npm run typecheck`, `npm test`, `npx next build` pass. Deploy with `railway up` from `app/` after merging to `main`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/recorders/started.ts` | Recorder keys, start-stamp SQL, `parseRecorderStart`, `getRecorderStart` |
| `src/lib/pipeline/stageEvents.ts` | `recordStageEvent(conn, ev)` (swallowing) |
| `src/lib/pipeline/stage.ts` | `writeStageId` gains `actor`, records from/to |
| `src/lib/pipeline/lapse.ts`, `stageRepo.ts`, `src/lib/leads.ts`, `src/lib/assistant/tools.ts`, callers | Pass actor / record on the paths that bypass `writeStageId` |
| `src/lib/marketing/sender/types.ts`, `sender/mailgun.ts` | `MailgunEvent` gains `url`, `occurredAt`, `contactId` |
| `src/lib/marketing/events.ts` | `applyEvent` appends an `email_events` row |
| `src/lib/statusDates.ts` | Pure `appointmentStatusDates`, `membershipStatusDates` |
| appointment + membership write sites | Apply the status-date patch |
| `src/lib/analytics/pageViews.ts` | Pure helpers + `recordPageView(conn, hit)` |
| `src/app/api/site-events/route.ts` | Public beacon endpoint |
| `src/components/cms/SiteBeacon.tsx` | Client beacon |
| `src/app/site/[siteSlug]/**` | Render `SiteBeacon` beside `SiteTracking`, and on the campaign landing page |

---

### Task 1: Recorder start stamps

**Files:**
- Create: `src/lib/recorders/started.ts`
- Modify: `src/lib/db/tenant.ts` (end of `ensureTenantTables`, after every `CREATE TABLE`)
- Test: `src/lib/recorders/started.test.ts`

**Interfaces:**
- Produces:
  - `RECORDER_KEYS = ["stage_history", "page_views", "email_events", "status_dates"] as const`, `type RecorderKey`
  - `recorderSettingKey(key: RecorderKey): string` → `"recorder_started:" + key`
  - `RECORDER_START_SQL: string` (the `INSERT OR IGNORE` statements for all four keys)
  - `parseRecorderStart(raw: string | null | undefined): Date | null` (pure)
  - `getRecorderStart(key: RecorderKey): Date | null` (ambient db, via `readKey`)

- [ ] **Step 1: Failing test** `src/lib/recorders/started.test.ts`

```ts
// Run: npm test -- src/lib/recorders/started.test.ts
//
// Recorder start stamps: set once per tenant on first boot after deploy and
// never moved, so a widget can say "Collecting since <date>". Pure parts only
// plus one real-SQLite check that the SQL is idempotent.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { RECORDER_KEYS, RECORDER_START_SQL, parseRecorderStart, recorderSettingKey } from "./started";

assert.deepEqual([...RECORDER_KEYS], ["stage_history", "page_views", "email_events", "status_dates"]);
assert.equal(recorderSettingKey("page_views"), "recorder_started:page_views");

assert.equal(parseRecorderStart(null), null);
assert.equal(parseRecorderStart("not json"), null);
assert.equal(parseRecorderStart('"nope"'), null);
assert.equal(parseRecorderStart('"2026-10-02T10:00:00.000Z"')?.toISOString(), "2026-10-02T10:00:00.000Z");

const sqlite = new Database(":memory:");
sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
sqlite.exec(RECORDER_START_SQL);
const first = sqlite.prepare("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[];
assert.equal(first.length, 4);
for (const r of first) assert.ok(parseRecorderStart(r.value), `${r.key} parses`);
sqlite.prepare("UPDATE settings SET value = ? WHERE key = ?").run('"2020-01-01T00:00:00.000Z"', "recorder_started:page_views");
sqlite.exec(RECORDER_START_SQL);
const again = sqlite.prepare("SELECT value FROM settings WHERE key = 'recorder_started:page_views'").get() as { value: string };
assert.equal(again.value, '"2020-01-01T00:00:00.000Z"', "a second run never moves the stamp");

console.log("started.test.ts: ok");
```

- [ ] **Step 2: Run, expect FAIL** (`npm test -- src/lib/recorders/started.test.ts`, module not found).

- [ ] **Step 3: Implement** `src/lib/recorders/started.ts`

```ts
/**
 * Event recorders (dashboard slice 2) start empty on deploy day. Each one is
 * stamped once per tenant, the first time ensureTenantTables runs after the
 * deploy, so a dashboard widget can say "Collecting since <date>" instead of
 * showing a misleading zero. The stamp never moves (INSERT OR IGNORE).
 */
import { readKey } from "@/lib/settings";

export const RECORDER_KEYS = ["stage_history", "page_views", "email_events", "status_dates"] as const;
export type RecorderKey = (typeof RECORDER_KEYS)[number];

export function recorderSettingKey(key: RecorderKey): string {
  return `recorder_started:${key}`;
}

/** Idempotent: run on every tenant open, only the first run writes. */
export const RECORDER_START_SQL = RECORDER_KEYS.map(
  (k) =>
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('${recorderSettingKey(k)}', json_quote(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));`,
).join("\n");

export function parseRecorderStart(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v !== "string") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** The tenant-scoped start date of a recorder, or null if not stamped. */
export function getRecorderStart(key: RecorderKey): Date | null {
  const v = readKey<unknown>(recorderSettingKey(key), null);
  return typeof v === "string" ? parseRecorderStart(JSON.stringify(v)) : null;
}
```

`readKey` imports `server-only` transitively. If requiring `./started` under the test runner fails on that import, move `getRecorderStart` into `src/lib/recorders/startedStore.ts` (with `import "server-only"`) and keep `started.ts` pure.

- [ ] **Step 4: Wire the stamp** — in `src/lib/db/tenant.ts`, at the END of `ensureTenantTables` (after the last table/ALTER block, so `settings` exists), add:

```ts
  // Dashboard slice 2: stamp each event recorder's start date once.
  try {
    sqlite.exec(RECORDER_START_SQL);
  } catch (err) {
    console.error("[recorders] could not stamp recorder start dates", err);
  }
```

with `import { RECORDER_START_SQL } from "@/lib/recorders/started";` at the top (if this creates an import cycle through `@/lib/settings` → `@/lib/db`, import from the pure file only; that is why `started.ts` must stay free of `readKey` if needed — see Step 3 note).

- [ ] **Step 5: Run test, typecheck; commit**

```bash
git add src/lib/recorders src/lib/db/tenant.ts
git commit -m "feat(recorders): stamp each event recorder's start date once per tenant"
```

---

### Task 2: Lead stage history

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/tenant.ts` (new table)
- Create: `src/lib/pipeline/stageEvents.ts`
- Modify: `src/lib/pipeline/stage.ts`, `src/lib/pipeline/lapse.ts`, `src/lib/pipeline/stageRepo.ts`, `src/lib/leads.ts`, `src/app/leads/actions.ts`, `src/lib/agents/tools.sales.ts`, `src/app/api/voice/webhook/route.ts`, `src/lib/assistant/tools.ts`
- Test: `src/lib/pipeline/stageEvents.test.ts`

**Interfaces:**
- Produces:
  - Table `lead_stage_events(id, lead_id, pipeline_id, from_stage_id NULL, to_stage_id, actor, at)`; drizzle `leadStageEvents`
  - `type StageActor = "user" | "agent" | "automation" | "system"`
  - `recordStageEvent(conn: TenantDb, ev: { leadId: number; pipelineId: number; fromStageId: number | null; toStageId: number; actor: StageActor }): void` — never throws; skips when `fromStageId === toStageId`
  - `writeStageId(leadId, stageId, note, actor: StageActor = "system")`
  - `setStageToId(leadId, stageId, actor: StageActor = "user")`
  - `UpsertLeadInput` gains optional `actor?: StageActor`

- [ ] **Step 1: Table**

`schema.ts` (append):

```ts
/** Every move of a lead between pipeline stages (dashboard slice 2 recorder). */
export const leadStageEvents = sqliteTable(
  "lead_stage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id").notNull(),
    pipelineId: integer("pipeline_id").notNull(),
    fromStageId: integer("from_stage_id"),
    toStageId: integer("to_stage_id").notNull(),
    actor: text("actor", { enum: ["user", "agent", "automation", "system"] }).notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byPipeline: index("idx_lead_stage_events_pipeline").on(t.pipelineId, t.at),
    byLead: index("idx_lead_stage_events_lead").on(t.leadId, t.at),
  }),
);
```

`tenant.ts` (inside the last big `sqlite.exec` block, beside `dashboards`):

```sql
    CREATE TABLE IF NOT EXISTS lead_stage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      pipeline_id INTEGER NOT NULL,
      from_stage_id INTEGER,
      to_stage_id INTEGER NOT NULL,
      actor TEXT NOT NULL,
      at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_stage_events_pipeline ON lead_stage_events(pipeline_id, at);
    CREATE INDEX IF NOT EXISTS idx_lead_stage_events_lead ON lead_stage_events(lead_id, at);
```

- [ ] **Step 2: Failing test** `src/lib/pipeline/stageEvents.test.ts` — scratch tenant, same shim and setup as `src/lib/dashboard/tabs.test.ts` (copy its header: `Module._load` stubs for `react` and `next/navigation`, scratch tenant insert into `controlSqlite`, `runWithTenant`, cleanup). Body:

```ts
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const { setStageToId, writeStageId } = requireLocal("./stage") as typeof import("./stage");
  const { listStages } = requireLocal("./stageRepo") as typeof import("./stageRepo");
  const { deleteStageWithMove } = requireLocal("./stageRepo") as typeof import("./stageRepo");
  const { recordStageEvent } = requireLocal("./stageEvents") as typeof import("./stageEvents");
  const events = () =>
    getTenantDbById(tid).select().from(schema.leadStageEvents).orderBy(schema.leadStageEvents.id).all();

  runWithTenant(tid, () => {
    // 1. creating a lead records entry into its first stage, from nothing.
    const { lead } = upsertLead({ source: "manual", firstName: "Ada", email: "ada@example.com", actor: "user" });
    let ev = events();
    assert.equal(ev.length, 1);
    assert.equal(ev[0].leadId, lead.id);
    assert.equal(ev[0].fromStageId, null);
    assert.equal(ev[0].toStageId, lead.stageId);
    assert.equal(ev[0].actor, "user");

    // 2. a manual move records from -> to with the actor passed.
    const stages = listStages(lead.pipelineId);
    const target = stages.find((s) => s.id !== lead.stageId)!;
    setStageToId(lead.id, target.id, "agent");
    ev = events();
    assert.equal(ev.length, 2);
    assert.equal(ev[1].fromStageId, lead.stageId);
    assert.equal(ev[1].toStageId, target.id);
    assert.equal(ev[1].actor, "agent");

    // 3. writing the same stage again records nothing.
    writeStageId(lead.id, target.id, "same", "system");
    assert.equal(events().length, 2);

    // 4. recordStageEvent never throws, even on a broken connection argument.
    assert.doesNotThrow(() =>
      recordStageEvent(null as never, { leadId: 1, pipelineId: 1, fromStageId: 1, toStageId: 2, actor: "system" }),
    );

    // 5. deleting a stage records a move for every lead on it.
    const other = stages.find((s) => s.id !== target.id && s.id !== lead.stageId)!;
    deleteStageWithMove(target.id, other.id);
    ev = events();
    assert.equal(ev.length, 3);
    assert.equal(ev[2].fromStageId, target.id);
    assert.equal(ev[2].toStageId, other.id);
    assert.equal(ev[2].actor, "user");
  });
  console.log("stageEvents.test.ts: ok");
```

Check `upsertLead`'s real input type and a fresh tenant's seeded stages (the default pipeline must have at least 3 stages; `DEFAULT_STAGES` in `src/lib/pipeline/roles.ts`). Adapt the test inputs to the real types without weakening assertions.

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: `stageEvents.ts`**

```ts
import "server-only";

import type { TenantDb } from "@/lib/db/tenant";
import { schema } from "@/lib/db";

export type StageActor = "user" | "agent" | "automation" | "system";

/**
 * Append one stage move to lead_stage_events. Append-only and fail-soft: a
 * recorder problem is logged and swallowed, never failing the stage write
 * that triggered it. A same-stage write is not a move and is skipped.
 */
export function recordStageEvent(
  conn: TenantDb,
  ev: { leadId: number; pipelineId: number; fromStageId: number | null; toStageId: number; actor: StageActor },
): void {
  if (ev.fromStageId === ev.toStageId) return;
  try {
    conn.insert(schema.leadStageEvents).values(ev).run();
  } catch (err) {
    console.error("[recorder:stage_history] could not record stage event", err);
  }
}
```

(Use the real `TenantDb` type export; check `src/lib/db/tenant.ts`.)

- [ ] **Step 5: Hook the writers**

`stage.ts` `writeStageId`: read the current raw stage before the update and record after it.

```ts
export function writeStageId(leadId: number, stageId: number, note: string, actor: StageActor = "system"): void {
  const before = db
    .select({ stageId: schema.leads.stageId, pipelineId: schema.leads.pipelineId })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .get();
  // ... existing body unchanged (pipelineId, stage, legacy, nurture cancel, update, logActivity) ...
  if (before) {
    recordStageEvent(db, { leadId, pipelineId: before.pipelineId, fromStageId: before.stageId ?? null, toStageId: stageId, actor });
  }
}
```

- `advanceStage`: pass `"automation"` to `writeStageId`.
- `reopenLostLead`: pass `"system"`.
- `setStageToId(leadId, stageId, actor: StageActor = "user")`: pass `actor` through.
- `src/lib/agents/tools.sales.ts` `setLeadStageTool`: call `setStageToId(id, stageId, "agent")`.
- `src/app/api/voice/webhook/route.ts`: `setStageToId(..., "automation")`.
- `src/app/leads/actions.ts` `setLeadStageAction`: leave the default (`"user"`).

`lapse.ts` `writeLapseStage(conn, leadId, role)`: read `before` on `conn` (same select as above, on `conn`), then after the update call `recordStageEvent(conn, { leadId, pipelineId: before.pipelineId, fromStageId: before.stageId ?? null, toStageId: stageId, actor: "system" })`.

`stageRepo.ts` `deleteStageWithMove`: inside the transaction, before the bulk update, select the affected leads; after the update, record one event per lead:

```ts
export function deleteStageWithMove(id: number, moveToId: number): void {
  db.transaction((tx) => {
    const moved = tx
      .select({ id: schema.leads.id, pipelineId: schema.leads.pipelineId })
      .from(schema.leads)
      .where(eq(schema.leads.stageId, id))
      .all();
    tx.update(schema.leads).set({ stageId: moveToId }).where(eq(schema.leads.stageId, id)).run();
    tx.delete(schema.pipelineStages).where(eq(schema.pipelineStages.id, id)).run();
    for (const l of moved) {
      recordStageEvent(db, { leadId: l.id, pipelineId: l.pipelineId, fromStageId: id, toStageId: moveToId, actor: "user" });
    }
  });
}
```

`leads.ts` `upsertLead`: add `actor?: StageActor` to the input type; after the insert, when `lead.stageId != null`:

```ts
  recordStageEvent(db, { leadId: lead.id, pipelineId: lead.pipelineId, fromStageId: null, toStageId: lead.stageId, actor: input.actor ?? "system" });
```

`src/app/leads/actions.ts` manual create (the `upsertLead` call at ~line 75): pass `actor: "user"`.

`src/lib/assistant/tools.ts` `createLead` (raw insert ~line 1635 on `tdb(ctx)`): after the insert returns the row, `recordStageEvent(tdb(ctx), { leadId: row.id, pipelineId: row.pipelineId, fromStageId: null, toStageId: row.stageId, actor: "agent" })` when `row.stageId != null`. If the insert does not return the row, add `.returning().get()`.

Do NOT touch `demoSeed.ts` or migrations.

- [ ] **Step 6: Run the new test, `src/lib/pipeline/*.test.ts`, `src/lib/agents/*.test.ts` (golden fixtures may assert tool behaviour), typecheck, full suite. Commit.**

```bash
git commit -m "feat(recorders): record every lead stage move with who made it"
```

---

### Task 3: Email event log

**Files:**
- Modify: `src/lib/marketing/sender/types.ts`, `src/lib/marketing/sender/mailgun.ts`, `src/lib/marketing/events.ts`, `src/lib/db/schema.ts`, `src/lib/db/tenant.ts`
- Test: extend `src/lib/marketing/sender/mailgun.test.ts` and `src/lib/marketing/events.test.ts`

**Interfaces:**
- `MailgunEvent` gains `url?: string` (clicked link), `occurredAt?: number` (epoch ms, from `event-data.timestamp` seconds float), `contactId?: number` (from `user-variables.contactId`).
- Table `email_events(id, campaign_id, send_id NULL, contact_id NULL, event, url NULL, at)`; drizzle `emailEvents`.
- `applyEvent` appends one `email_events` row per webhook call when a `campaign_sends` row matched; never throws because of it.

- [ ] **Step 1: Tests first**

In `mailgun.test.ts`, add a parse case with the real Mailgun shape:

```ts
{
  const ev = parseMailgunEvent({
    "event-data": {
      event: "clicked",
      recipient: "a@b.ie",
      timestamp: 1759400000.123,
      url: "https://example.ie/offer",
      message: { headers: { "message-id": "<abc@mg.example>" } },
      "user-variables": { campaignId: "7", tenantId: "3", contactId: "42" },
    },
  });
  assert.equal(ev?.url, "https://example.ie/offer");
  assert.equal(ev?.occurredAt, 1759400000123);
  assert.equal(ev?.contactId, 42);
}
{
  const ev = parseMailgunEvent({ "event-data": { event: "opened", recipient: "a@b.ie", url: 5, timestamp: "x", message: { headers: { "message-id": "<m>" } } } });
  assert.equal(ev?.url, undefined, "non-string url ignored");
  assert.equal(ev?.occurredAt, undefined, "non-numeric timestamp ignored");
}
```

In `events.test.ts` (read its existing setup first; it already builds a tenant with `campaign_sends`), add: after `applyEvent(tid, {event:"opened", ...})` and `applyEvent(tid, {event:"clicked", url, occurredAt, ...})` for the same send, `email_events` has 2 rows with the right `campaign_id`, `send_id`, `contact_id`, `event`, `url` (null for opened), and `at` equal to `occurredAt` when given; and an event whose message id matches no send writes no row and does not throw. Also: replaying the same webhook twice appends twice (it is an event log; dedupe is not this recorder's job — note this in the test comment).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

`types.ts`: add the three optional fields with doc comments.

`mailgun.ts` `parseMailgunEvent`, before `return result;`:

```ts
  const urlRaw = prop(data, "url");
  if (typeof urlRaw === "string" && urlRaw.trim()) result.url = urlRaw.trim().slice(0, 2000);
  const ts = prop(data, "timestamp");
  if (typeof ts === "number" && Number.isFinite(ts)) result.occurredAt = Math.round(ts * 1000);
  const contactId = toFiniteNumber(prop(userVars, "contactId"));
  if (contactId !== null) result.contactId = contactId;
```

Schema + DDL:

```ts
/** Every Mailgun engagement event, append-only (dashboard slice 2 recorder). */
export const emailEvents = sqliteTable(
  "email_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id").notNull(),
    sendId: integer("send_id"),
    contactId: integer("contact_id"),
    event: text("event").notNull(),
    url: text("url"),
    at: integer("at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byCampaign: index("idx_email_events_campaign").on(t.campaignId, t.at),
    byEvent: index("idx_email_events_event").on(t.event, t.at),
  }),
);
```

```sql
    CREATE TABLE IF NOT EXISTS email_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      send_id INTEGER,
      contact_id INTEGER,
      event TEXT NOT NULL,
      url TEXT,
      at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_email_events_campaign ON email_events(campaign_id, at);
    CREATE INDEX IF NOT EXISTS idx_email_events_event ON email_events(event, at);
```

`events.ts` `applyEvent`, inside `if (row) { ... }` after the status update and before `recomputeCampaignStats`:

```ts
    try {
      tdb.insert(emailEvents).values({
        campaignId: row.campaignId,
        sendId: row.id,
        contactId: row.contactId ?? event.contactId ?? null,
        event: event.event,
        url: event.event === "clicked" ? event.url ?? null : null,
        at: new Date(event.occurredAt ?? Date.now()),
      }).run();
    } catch (err) {
      console.error("[recorder:email_events] could not record email event", err);
    }
```

- [ ] **Step 4: Tests pass, typecheck, full suite. Commit.**

```bash
git commit -m "feat(recorders): log every Mailgun email event with click URL and time"
```

---

### Task 4: Cancellation and end dates

**Files:**
- Create: `src/lib/statusDates.ts`, test `src/lib/statusDates.test.ts`
- Modify: `src/lib/db/schema.ts`, `src/lib/db/tenant.ts` (columns), `src/lib/db/migrations/index.ts` (backfill)
- Modify write sites: `src/app/appointments/actions.ts` (~72 insert, ~146 status, ~233 complete, ~288 un-complete), `src/app/api/appointments/route.ts` (~151 insert), `src/lib/scheduling/bookConsultation.ts` (~90 insert), `src/lib/assistant/tools.ts` (~1339 insert, ~1813 cancelAppointment, ~1888 cancelMembership), `src/lib/memberships.ts` (~192 setClientMembershipStatus)

**Interfaces:**
- Columns: `appointments.cancelled_at INTEGER NULL`, `appointments.cancelled_at_approx INTEGER NOT NULL DEFAULT 0`; `client_memberships.ended_at INTEGER NULL`.
- `appointmentStatusDates(prev: AppointmentStatus | null, next: AppointmentStatus, now: Date): { cancelledAt?: Date | null; cancelledAtApprox?: boolean }`
- `membershipStatusDates(prev: MembershipStatus | null, next: MembershipStatus, now: Date): { endedAt?: Date | null }`

Rules: a patch key is present only when it should change. Appointment: entering `cancelled`/`no_show` from a different status sets `cancelledAt: now, cancelledAtApprox: false`; moving between `cancelled` and `no_show` keeps the original date (no key); leaving `cancelled`/`no_show` to any other status sets `cancelledAt: null, cancelledAtApprox: false`; otherwise `{}`. Insert = `prev: null`. Membership: leaving `active` (to `expired`/`cancelled`) sets `endedAt: now`; returning to `active` sets `endedAt: null`; between `expired` and `cancelled` keeps the date; insert as `active` = `{}`.

Historic memberships have no reliable date (no `updated_at` column), so they are NOT backfilled; churn widgets count only from the recorder start. Historic appointments ARE backfilled from `updated_at` with `cancelled_at_approx = 1`.

- [ ] **Step 1: Failing test** `src/lib/statusDates.test.ts`

```ts
// Run: npm test -- src/lib/statusDates.test.ts
import assert from "node:assert/strict";
import { appointmentStatusDates, membershipStatusDates } from "./statusDates";

const now = new Date("2026-10-02T12:00:00Z");

assert.deepEqual(appointmentStatusDates("scheduled", "cancelled", now), { cancelledAt: now, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates("confirmed", "no_show", now), { cancelledAt: now, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates("cancelled", "no_show", now), {}, "keeps the original date");
assert.deepEqual(appointmentStatusDates("cancelled", "scheduled", now), { cancelledAt: null, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates("scheduled", "completed", now), {});
assert.deepEqual(appointmentStatusDates(null, "no_show", now), { cancelledAt: now, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates(null, "scheduled", now), {});

assert.deepEqual(membershipStatusDates("active", "cancelled", now), { endedAt: now });
assert.deepEqual(membershipStatusDates("active", "expired", now), { endedAt: now });
assert.deepEqual(membershipStatusDates("expired", "cancelled", now), {});
assert.deepEqual(membershipStatusDates("cancelled", "active", now), { endedAt: null });
assert.deepEqual(membershipStatusDates(null, "active", now), {});

console.log("statusDates.test.ts: ok");
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `statusDates.ts`** (pure; take the status unions from the schema types or declare them locally to stay import-free).

```ts
/**
 * Status-date bookkeeping for the dashboard's status_dates recorder: when an
 * appointment was cancelled (or no-showed) and when a membership ended. Pure;
 * every write site spreads the returned patch into its update/insert. A key
 * is present only when the date should change.
 */
export type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
export type MembershipStatus = "active" | "expired" | "cancelled";

const CANCELLED: ReadonlySet<AppointmentStatus> = new Set(["cancelled", "no_show"]);

export function appointmentStatusDates(
  prev: AppointmentStatus | null,
  next: AppointmentStatus,
  now: Date,
): { cancelledAt?: Date | null; cancelledAtApprox?: boolean } {
  const was = prev !== null && CANCELLED.has(prev);
  const is = CANCELLED.has(next);
  if (is && !was) return { cancelledAt: now, cancelledAtApprox: false };
  if (!is && was) return { cancelledAt: null, cancelledAtApprox: false };
  return {};
}

export function membershipStatusDates(
  prev: MembershipStatus | null,
  next: MembershipStatus,
  now: Date,
): { endedAt?: Date | null } {
  const wasEnded = prev !== null && prev !== "active";
  const isEnded = next !== "active";
  if (isEnded && !wasEnded) return { endedAt: now };
  if (!isEnded && wasEnded) return { endedAt: null };
  return {};
}
```

- [ ] **Step 4: Columns + backfill**

`schema.ts`: add to `appointments`: `cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" })`, `cancelledAtApprox: integer("cancelled_at_approx", { mode: "boolean" }).notNull().default(false)`; to `clientMemberships`: `endedAt: integer("ended_at", { mode: "timestamp_ms" })`.

`tenant.ts`: add the columns with the existing PRAGMA-guarded `addCol` pattern (see the `ai_triaged_at` / `landing_views` examples), one block per table:

```ts
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(appointments)`).all() as Array<{ name: string }>;
    const addCol = (name: string, ddl: string) => {
      if (cols.length > 0 && !cols.find((c) => c.name === name)) sqlite.exec(`ALTER TABLE appointments ADD COLUMN ${ddl}`);
    };
    addCol("cancelled_at", "cancelled_at INTEGER");
    addCol("cancelled_at_approx", "cancelled_at_approx INTEGER NOT NULL DEFAULT 0");
  } catch (err) {
    console.error("[tenant] appointments status-date columns", err);
  }
  // same for client_memberships: ended_at INTEGER
```

Place these BEFORE `runMigrations(sqlite, TENANT_MIGRATIONS)` is called (check the call order in `openTenantDb`/`ensureTenantTables`), because the backfill migration needs the column.

`migrations/index.ts`: append to `TENANT_MIGRATIONS` (next free id; read the array's last id):

```ts
  {
    id: "00NN-appointment-cancelled-at-backfill",
    description: "Dashboard slice 2: approximate cancelled_at for existing cancelled/no-show appointments from updated_at",
    up: (sqlite) => {
      sqlite.exec(`
        UPDATE appointments
        SET cancelled_at = updated_at, cancelled_at_approx = 1
        WHERE status IN ('cancelled', 'no_show') AND cancelled_at IS NULL
      `);
    },
  },
```

Check `src/lib/db/migrations/index.test.ts` / `wiring.test.ts` for invariants the new entry must satisfy (id format, ordering).

- [ ] **Step 5: Apply at every write site.** For updates, read the previous status first (most sites already load the row; otherwise a one-column select). Examples:

```ts
// appointments/actions.ts updateStatusAction
const prev = db.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, id)).get();
db.update(appointments)
  .set({ status, updatedAt: new Date(), ...appointmentStatusDates(prev?.status ?? null, status, new Date()) })
  .where(eq(appointments.id, id))
  .run();

// inserts (actions.ts ~72, api/appointments/route.ts ~151, bookConsultation.ts ~90, assistant/tools.ts ~1339)
.values({ ...existing, ...appointmentStatusDates(null, status, new Date()) })

// assistant/tools.ts cancelAppointment (~1813): also set updatedAt
.set({ status: "cancelled", updatedAt: new Date(), ...appointmentStatusDates(prev, "cancelled", new Date()) })

// memberships.ts setClientMembershipStatus
const prev = db.select({ status: clientMemberships.status }).from(clientMemberships).where(eq(clientMemberships.id, id)).get();
.set({ status, ...membershipStatusDates(prev?.status ?? null, status, new Date()) })

// assistant/tools.ts cancelMembership (~1888)
.set({ status: "cancelled", ...membershipStatusDates(prev, "cancelled", new Date()) })
```

Grep to be sure nothing is missed: `grep -rn "appointments)\s*\.set\|status: \"cancelled\"\|status: \"no_show\"\|clientMemberships)\s*\.set" src --include=*.ts --include=*.tsx`. Inserts as `active` memberships need no change. Do not touch `demoSeed.ts`.

- [ ] **Step 6: Tests, typecheck, full suite (`src/lib/db/migrations/*.test.ts` especially). Commit.**

```bash
git commit -m "feat(recorders): record when appointments are cancelled and memberships end"
```

---

### Task 5: Website page views

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/tenant.ts` (three tables)
- Create: `src/lib/analytics/pageViews.ts`, test `src/lib/analytics/pageViews.test.ts`
- Create: `src/app/api/site-events/route.ts`
- Modify: `src/middleware.ts` (`PUBLIC_API_PREFIXES`)
- Create: `src/components/cms/SiteBeacon.tsx`
- Modify: `src/app/site/[siteSlug]/page.tsx`, `[...slug]/page.tsx`, `blog/page.tsx`, `blog/[slug]/page.tsx`, `c/[campaignSlug]/page.tsx`

**Interfaces:**
- Tables:
  - `site_page_views_daily(site_id, day TEXT, path, referrer_domain TEXT NOT NULL DEFAULT '', utm_source TEXT NOT NULL DEFAULT '', views INTEGER, uniques INTEGER)`, PRIMARY KEY `(site_id, day, path, referrer_domain, utm_source)`
  - `site_visitors_daily(site_id, day, uniques)`, PRIMARY KEY `(site_id, day)`
  - `site_visitor_hashes(day, site_id, path, hash)`, PRIMARY KEY `(day, site_id, path, hash)`; `path = ''` marks a site-level visitor
- Pure (pageViews.ts): `isBot(ua: string | null): boolean`, `referrerDomain(ref: string | null, ownHost: string): string` (external host without `www.`, else `''`), `cleanPath(p: unknown): string | null` (must start with `/`, strip query/hash, max 300 chars, collapse trailing slash except root), `cleanUtm(v: unknown): string` (lowercase, `[a-z0-9._-]`, max 60), `visitorHash(secret: string, day: string, siteId: number, ip: string, ua: string): string` (sha256 hex)
- Server: `recordPageView(conn: TenantDb, hit: { siteId: number; day: string; path: string; referrerDomain: string; utmSource: string; hash: string }): void` — fail-soft; purges hashes for days before `hit.day`.

- [ ] **Step 1: Tables** (schema + DDL)

```sql
    CREATE TABLE IF NOT EXISTS site_page_views_daily (
      site_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      referrer_domain TEXT NOT NULL DEFAULT '',
      utm_source TEXT NOT NULL DEFAULT '',
      views INTEGER NOT NULL DEFAULT 0,
      uniques INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, day, path, referrer_domain, utm_source)
    );
    CREATE TABLE IF NOT EXISTS site_visitors_daily (
      site_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      uniques INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, day)
    );
    CREATE TABLE IF NOT EXISTS site_visitor_hashes (
      day TEXT NOT NULL,
      site_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (day, site_id, path, hash)
    );
```

Drizzle definitions to match (`primaryKey({ columns: [...] })` from `drizzle-orm/sqlite-core`; check how other composite keys are declared in schema.ts).

- [ ] **Step 2: Failing tests** `src/lib/analytics/pageViews.test.ts` — pure part:

```ts
assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1"), false);
assert.equal(isBot(null), true, "no user agent is treated as a bot");
assert.equal(isBot("HeadlessChrome/120"), true);
assert.equal(referrerDomain("https://www.google.com/search?q=x", "optimalhealthatinspire.ie"), "google.com");
assert.equal(referrerDomain("https://optimalhealthatinspire.ie/about", "optimalhealthatinspire.ie"), "");
assert.equal(referrerDomain("https://www.optimalhealthatinspire.ie/x", "optimalhealthatinspire.ie"), "", "www of own host is internal");
assert.equal(referrerDomain("garbage", "a.ie"), "");
assert.equal(cleanPath("/about/?x=1#top"), "/about");
assert.equal(cleanPath("/"), "/");
assert.equal(cleanPath("about"), null);
assert.equal(cleanPath(5), null);
assert.equal(cleanPath("/" + "a".repeat(400))?.length, 300);
assert.equal(cleanUtm("Facebook Ads!"), "facebookads");
assert.equal(cleanUtm(undefined), "");
const h1 = visitorHash("s", "2026-10-02", 1, "1.2.3.4", "ua");
assert.equal(h1.length, 64);
assert.notEqual(h1, visitorHash("s", "2026-10-03", 1, "1.2.3.4", "ua"), "rotates daily");
assert.notEqual(h1, visitorHash("s", "2026-10-02", 2, "1.2.3.4", "ua"), "per site");
```

DB part (scratch tenant, same shim as `src/lib/dashboard/tabs.test.ts`): two hits same visitor same path same day → `views=2, uniques=1` on the path row and `site_visitors_daily.uniques=1`; a second visitor → `uniques=2`; a different referrer → separate row; a hit on the next day purges the previous day's hashes (`site_visitor_hashes` has no rows for the old day) while the daily aggregates stay; `recordPageView(null as never, ...)` does not throw.

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement `pageViews.ts`**

```ts
import crypto from "node:crypto";

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|whatsapp|curl|wget|python|axios|node-fetch|monitor|uptime/i;

export function isBot(ua: string | null): boolean {
  return !ua || BOT_RE.test(ua);
}

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, "");

export function referrerDomain(ref: string | null, ownHost: string): string {
  if (!ref) return "";
  try {
    const host = stripWww(new URL(ref).hostname);
    return host && host !== stripWww(ownHost) ? host.slice(0, 120) : "";
  } catch {
    return "";
  }
}

export function cleanPath(p: unknown): string | null {
  if (typeof p !== "string" || !p.startsWith("/")) return null;
  let path = p.split(/[?#]/)[0];
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  return path.slice(0, 300);
}

export function cleanUtm(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 60) : "";
}

export function visitorHash(secret: string, day: string, siteId: number, ip: string, ua: string): string {
  return crypto.createHash("sha256").update(`${secret}|${day}|${siteId}|${ip}|${ua}`).digest("hex");
}
```

`recordPageView` (same file is fine if it stays importable by the test; otherwise `pageViewStore.ts` with `server-only`), using the raw better-sqlite3 handle is NOT available through drizzle's `TenantDb` easily — use drizzle `sql` with `conn.run(sql\`...\`)`:

```ts
export function recordPageView(conn: TenantDb, hit: PageHit): void {
  try {
    conn.transaction((tx) => {
      tx.run(sql`DELETE FROM site_visitor_hashes WHERE day < ${hit.day}`);
      const newOnPath =
        tx.run(sql`INSERT OR IGNORE INTO site_visitor_hashes (day, site_id, path, hash) VALUES (${hit.day}, ${hit.siteId}, ${hit.path}, ${hit.hash})`).changes > 0;
      const newOnSite =
        tx.run(sql`INSERT OR IGNORE INTO site_visitor_hashes (day, site_id, path, hash) VALUES (${hit.day}, ${hit.siteId}, '', ${hit.hash})`).changes > 0;
      tx.run(sql`
        INSERT INTO site_page_views_daily (site_id, day, path, referrer_domain, utm_source, views, uniques)
        VALUES (${hit.siteId}, ${hit.day}, ${hit.path}, ${hit.referrerDomain}, ${hit.utmSource}, 1, ${newOnPath ? 1 : 0})
        ON CONFLICT (site_id, day, path, referrer_domain, utm_source)
        DO UPDATE SET views = views + 1, uniques = uniques + ${newOnPath ? 1 : 0}
      `);
      if (newOnSite) {
        tx.run(sql`
          INSERT INTO site_visitors_daily (site_id, day, uniques) VALUES (${hit.siteId}, ${hit.day}, 1)
          ON CONFLICT (site_id, day) DO UPDATE SET uniques = uniques + 1
        `);
      }
    });
  } catch (err) {
    console.error("[recorder:page_views] could not record page view", err);
  }
}
```

Note: `uniques` on a path row counts visitors new to that path today, attributed to the referrer/utm row of their first hit; document this in a comment. Verify `.run()` returns `{ changes }` under this drizzle version (better-sqlite3 `RunResult`); adapt if not.

- [ ] **Step 5: Route `src/app/api/site-events/route.ts`**

```ts
import { headers } from "next/headers";
import { runWithTenant } from "@/lib/db/tenant";
import { resolvePublicSite, normalizeHost } from "@/lib/cms/resolveHost";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { cleanPath, cleanUtm, isBot, recordPageView, referrerDomain, visitorHash } from "@/lib/analytics/pageViews";

export const dynamic = "force-dynamic";

const NO_CONTENT = () => new Response(null, { status: 204 });
// Stable for the life of the process when no secret is configured: uniques
// then reset on a restart, which only over-counts, never leaks.
const FALLBACK_SECRET = crypto.randomUUID();

/**
 * First-party, cookieless page-view beacon for tenant websites (dashboard
 * slice 2). Always 204: a visitor's browser must never see an error from
 * analytics. Counted only when the request host maps to a verified site
 * domain, so dev previews and forged hosts count nothing.
 */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`site-events:${ip}`, 120, 60_000).ok) return NO_CONTENT();
    const ua = req.headers.get("user-agent");
    if (isBot(ua)) return NO_CONTENT();
    const host = headers().get("host");
    const site = resolvePublicSite({ host, siteParam: null });
    if (!site || site.resolvedVia !== "host") return NO_CONTENT();
    const body = (await req.json().catch(() => null)) as { p?: unknown; r?: unknown; u?: unknown } | null;
    const path = cleanPath(body?.p);
    if (!path) return NO_CONTENT();
    const day = new Date().toISOString().slice(0, 10);
    const secret = process.env.ANALYTICS_SALT || process.env.EMAIL_TOKEN_SECRET || FALLBACK_SECRET;
    runWithTenant(site.tenantId, () =>
      recordPageView(site.db, {
        siteId: site.site.id,
        day,
        path,
        referrerDomain: referrerDomain(typeof body?.r === "string" ? body.r : null, normalizeHost(host) ?? ""),
        utmSource: cleanUtm(body?.u),
        hash: visitorHash(secret, day, site.site.id, ip, ua ?? ""),
      }),
    );
  } catch (err) {
    console.error("[recorder:page_views] beacon failed", err);
  }
  return NO_CONTENT();
}
```

Check `resolvePublicSite`'s exact return shape (`db`, `tenantId`, `site.id`, `resolvedVia`) and `normalizeHost`'s signature; adapt names. Add `"/api/site-events", // public first-party page-view beacon (cookieless, rate-limited, host-verified, always 204)` to `PUBLIC_API_PREFIXES` in `src/middleware.ts`.

- [ ] **Step 6: Beacon `src/components/cms/SiteBeacon.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Anonymous first-party page-view beacon. No cookie, no storage, no
 * identifiers: it sends the path, the referrer and a utm_source, and the
 * server aggregates per day. Not consent-gated because it stores nothing
 * about the visitor (see /api/site-events). Rendered only on public pages,
 * never in Studio edit mode or draft previews.
 */
export function SiteBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const u = new URLSearchParams(window.location.search).get("utm_source") ?? "";
      const body = JSON.stringify({ p: window.location.pathname, r: document.referrer || "", u });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/site-events", new Blob([body], { type: "application/json" }));
      else void fetch("/api/site-events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } });
    } catch {
      // analytics must never break the page
    }
  }, [pathname]);
  return null;
}
```

Note: in production the public site is served at the client's own domain with paths rewritten by middleware, so `window.location.pathname` is the visitor-facing path (what we want). Confirm by reading `src/middleware.ts` rewrite.

- [ ] **Step 7: Render it** next to every `<SiteTracking ... />` in `src/app/site/[siteSlug]/page.tsx`, `[...slug]/page.tsx`, `blog/page.tsx`, `blog/[slug]/page.tsx`, inside the SAME condition that already excludes `cmsedit` and draft previews (read each file; `SiteBeacon` must not render where `SiteTracking` is suppressed for edit/preview). On `c/[campaignSlug]/page.tsx`, render `<SiteBeacon />` in the page output, only on the normal visitor render path (the one that passes `countView: true`), not in any preview path.

- [ ] **Step 8: Tests, typecheck, full suite, build. Commit.**

```bash
git commit -m "feat(recorders): first-party cookieless page views for tenant websites"
```

---

### Task 6: Verify, merge, deploy, check production

- [ ] **Step 1:** `npm run typecheck && npm test && npx next build`.
- [ ] **Step 2: Local smoke.** `npm run dev`; `curl -s -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -d '{"p":"/"}' http://localhost:3000/api/site-events` returns `204` (and records nothing: localhost is not a verified host). Move a lead on the board as an admin and confirm a `lead_stage_events` row in the local tenant DB with `actor = 'user'`. Cancel an appointment and confirm `cancelled_at` is set. Remove any local test rows afterwards.
- [ ] **Step 3:** merge the branch to `main` (`--no-ff`), push, `cd app && railway up`, poll the deployment to `SUCCESS` (a transient `next/font` Google fetch failure on the builder is known; redeploy once).
- [ ] **Step 4: Production check over `railway ssh`** (read-only): for the live tenant DB (`optimal-health`, find its `db_file` in control.db `tenants`), confirm the four `recorder_started:*` settings rows exist, the three new tables and columns exist (`PRAGMA table_info`), and the backfill migration id is in `schema_migrations`. Do not write anything.

---

## Self-review notes

- Spec 2a (stage history incl. lead creation row, all writers, actors): Task 2, including the two writers that bypass `writeStageId` (lapse job on an explicit conn; stage delete bulk move) and the agent's raw lead insert.
- Spec 2b (page views, cookieless, host-resolved, bots, rate limit, hash purge, landing pages): Task 5. Campaign landing keeps its `landingViews` counter untouched; it now also feeds the daily table via the beacon.
- Spec 2c (email event log alongside unchanged status/stats): Task 3. The parser previously dropped url/timestamp/contactId; added.
- Spec 2d (cancelled_at, ended_at, backfill approx): Task 4. Deviation, recorded: memberships have no `updated_at`, so historic memberships are not backfilled (no honest date exists); churn counts from the recorder start.
- "Collecting since": Task 1 stamps; slice 3 widgets read `getRecorderStart`.
