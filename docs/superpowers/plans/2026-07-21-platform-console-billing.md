# Platform Console + Subscription Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate platform-admin app (`admin/`, deployed to admin.clientflow.ie) driving a `/api/platform/*` API in the main app, plus a flat-price subscription billing engine (no trial, dunning d1/3/7 → suspend) built on a `PaymentProvider` abstraction with a DevProvider now and CreatePay/Cardstream later.

**Architecture:** All data + billing logic live in the main app (`app/`), which owns control.db. The admin app has NO database — its server components call `/api/platform/*` with a service key + platform-admin session token. Billing state is new control.db tables accessed via raw `controlSqlite` prepared statements (same pattern as `getCronState`).

**Tech Stack:** Next.js 14 App Router (both apps), better-sqlite3 (raw SQL for billing tables), node:assert tests run with `npx tsx`, Resend for platform emails.

**Spec:** `docs/superpowers/specs/2026-07-21-platform-console-billing-design.md` — the authority on lifecycle, enforcement grid, and API surface.

## Global Constraints

- **No git commits** (user's flow): each task ends with typecheck + tests + manual verification, not a commit. Deploys happen at the end via `railway up`.
- **Money is integer cents, EUR.** Never floats. VAT recorded per invoice as basis points (`2300` = 23%).
- **Timestamps** are INTEGER ms-epoch (`Date.now()`); **calendar dates** (renewal/period/dunning) are `'YYYY-MM-DD'` strings computed in **Europe/Dublin**.
- **Billing/platform code NEVER uses the request-scoped `db` proxy** — only `controlSqlite`/`controlDb` (control plane) and `getTenantDbById(tenantId)` (cross-tenant reads).
- **Billing suspension ≠ `tenants.is_active`.** `is_active` stays the manual kill switch. Suspension is `tenant_billing.status='suspended'`, enforced by the billing gate. The gate ONLY applies when a `tenant_billing` row exists (legacy tenants without rows are unaffected).
- Env: `PAYMENT_PROVIDER` = `dev` (default) | `cardstream`. `PLATFORM_API_KEY` shared secret between the two apps. Admin app additionally: `MAIN_APP_URL`.
- Default platform price **€99.00/mo (9900 cents)**, VAT **2300bp** — stored in `platform_settings`, editable in the console.
- Existing helpers to reuse (verified real): `requirePlatformAdmin()`, `hashPassword`/`verifyPassword` (scrypt), `rateLimit(key, limit, windowMs)` + `clientIp(req)` from `@/lib/rateLimit`, the constant-time `secretMatches` pattern from `src/app/api/cron/daily/route.ts`, `sendEmail`/`renderEmailShell`/`escapeHtml` from `@/lib/email`, `createTenant`/`createTenantAdmin`/`seedTenant` from `@/lib/tenants`, `getTenantDbById` from `@/lib/db/tenant`, `getCronState`/`setCronState` + `controlSqlite` from `@/lib/db/control`.
- Tests: plain `.test.ts` files using `node:assert/strict`, run with `npx tsx <file>` from `app/` (matches `src/lib/motion.test.ts`).
- Admin app styling: dark premium tokens consistent with the main admin (Space Grotesk headings via `next/font/google`, system body font); keep dependencies minimal (`next`, `react`, `react-dom` only).

## File Structure

**Main app (`app/src/`):**
- `lib/db/control.ts` — modify: add billing DDL to `ensureControlTables()`
- `lib/billing/money.ts`, `lib/billing/dates.ts` — pure helpers (tested)
- `lib/billing/settings.ts` — platform_settings accessors
- `lib/billing/engine.ts` — state machine + billing run + admin actions (tested)
- `lib/billing/emails.ts` — platform-sender billing emails
- `lib/payments/provider.ts` — `PaymentProvider` interface + `getPaymentProvider()`
- `lib/payments/devProvider.ts` — dev/mock provider
- `lib/platform/auth.ts` — service-key check + platform sessions
- `app/api/platform/…` — auth/login, auth/logout, auth/me, overview, tenants, tenants/[id], tenants/[id]/[action], settings
- `app/api/billing/capture/start/route.ts`, `app/api/dev-pay/complete/route.ts`, `app/(dev)/dev/pay/[ref]/page.tsx`
- `app/api/cron/billing/route.ts`; `lib/automations/scheduler.ts` — modify (add billing to daily run)
- `app/billing/activate/page.tsx`, `app/billing/suspended/page.tsx`, `app/settings/billing/page.tsx` + billing-gate wiring in the authed layout
- `lib/tenants.ts` — modify: `venueType` threading + gym seeding + billing-row creation
- `middleware.ts` — modify: add `/api/platform/` + `/billing` handling
- `tools/seed-billing.cjs` — one-time: exempt rows for existing tenants + platform-admin flag

**Admin app (`admin/`):** scaffold + `src/lib/api.ts` (typed fetch wrapper) + `src/lib/session.ts` + pages: login, dashboard, gyms, gyms/[id], provision, settings.

---

### Task 1: Billing tables + money/date helpers

**Files:**
- Modify: `app/src/lib/db/control.ts` (inside `ensureControlTables()`, before the closing backtick of the big `exec`)
- Create: `app/src/lib/billing/money.ts`, `app/src/lib/billing/dates.ts`
- Test: `app/src/lib/billing/helpers.test.ts`

**Interfaces:**
- Produces: `computeVat(netCents, vatRateBp) → {netCents, vatCents, grossCents}`, `formatCents(cents) → "€99.00"`, `dublinToday() → 'YYYY-MM-DD'`, `dublinDayOfMonth(dateStr) → number`, `addMonthClamped(dateStr, anchorDay) → 'YYYY-MM-DD'`, `addDays(dateStr, n) → 'YYYY-MM-DD'`, `cmpDate(a, b) → number`. Later tasks rely on these exact names.

- [ ] **Step 1: Add the billing DDL.** In `app/src/lib/db/control.ts`, append inside the `controlSqlite.exec(\`…\`)` template (after the `gmail_connections` table, before the closing backtick):

```sql
    -- ── Platform billing (spec 2026-07-21) ────────────────────────────────
    -- One row per tenant that participates in billing. Legacy tenants without
    -- a row are NOT gated. billing_exempt=1 → agency-run tenant: shown as
    -- active, never charged, excluded from MRR.
    CREATE TABLE IF NOT EXISTS tenant_billing (
      tenant_id       INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'pending_payment'
                      CHECK (status IN ('pending_payment','active','past_due','suspended','cancelled')),
      billing_exempt  INTEGER NOT NULL DEFAULT 0,
      card_token      TEXT,
      card_last4      TEXT,
      card_expiry     TEXT,
      anchor_day      INTEGER,
      next_renewal_at TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      last_failure_at INTEGER,
      activated_at    INTEGER,
      suspended_at    INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS billing_invoices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      period_start    TEXT NOT NULL,
      period_end      TEXT NOT NULL,
      net_cents       INTEGER NOT NULL,
      vat_cents       INTEGER NOT NULL,
      gross_cents     INTEGER NOT NULL,
      vat_rate_bp     INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'EUR',
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','waived','refunded')),
      gateway_ref     TEXT,
      attempt_count   INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      paid_at         INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE (tenant_id, period_start)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant ON billing_invoices(tenant_id);

    CREATE TABLE IF NOT EXISTS billing_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER,
      type       TEXT NOT NULL,
      detail     TEXT,
      actor      TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_events_tenant ON billing_events(tenant_id, created_at);

    CREATE TABLE IF NOT EXISTS platform_sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- A pending hosted-capture session (provider-agnostic): maps the provider's
    -- session ref back to the tenant + purpose on callback/completion.
    CREATE TABLE IF NOT EXISTS capture_sessions (
      ref         TEXT PRIMARY KEY,
      tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      purpose     TEXT NOT NULL CHECK (purpose IN ('activate','update_card','reactivate')),
      amount_cents INTEGER,
      invoice_id  INTEGER,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed')),
      created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
```

- [ ] **Step 2: Write the failing tests** — `app/src/lib/billing/helpers.test.ts`:

```ts
// Run: npx tsx src/lib/billing/helpers.test.ts
import assert from "node:assert/strict";
import { computeVat, formatCents } from "./money";
import { addMonthClamped, addDays, cmpDate, dublinDayOfMonth } from "./dates";

// VAT: 23% of €99.00 → €22.77; gross €121.77. Rounding is half-up per cent.
assert.deepEqual(computeVat(9900, 2300), { netCents: 9900, vatCents: 2277, grossCents: 12177 });
assert.deepEqual(computeVat(3333, 2300), { netCents: 3333, vatCents: 767, grossCents: 4100 }); // 766.59 → 767
assert.deepEqual(computeVat(9900, 0), { netCents: 9900, vatCents: 0, grossCents: 9900 });
assert.equal(formatCents(12177), "€121.77");
assert.equal(formatCents(9900), "€99.00");

// Month advance clamps to month length but RESTORES the anchor when possible.
assert.equal(addMonthClamped("2026-01-31", 31), "2026-02-28"); // clamp
assert.equal(addMonthClamped("2026-02-28", 31), "2026-03-31"); // restore anchor
assert.equal(addMonthClamped("2024-01-31", 31), "2024-02-29"); // leap year
assert.equal(addMonthClamped("2026-03-31", 31), "2026-04-30");
assert.equal(addMonthClamped("2026-07-15", 15), "2026-08-15"); // plain case
assert.equal(addMonthClamped("2026-12-15", 15), "2027-01-15"); // year wrap

assert.equal(addDays("2026-02-27", 3), "2026-03-02");
assert.equal(cmpDate("2026-07-01", "2026-07-02") < 0, true);
assert.equal(cmpDate("2026-07-02", "2026-07-02"), 0);
assert.equal(dublinDayOfMonth("2026-07-31"), 31);

console.log("helpers.test.ts: all assertions passed");
```

- [ ] **Step 3: Run to verify failure.** `cd app && npx tsx src/lib/billing/helpers.test.ts` → FAIL (cannot find `./money`).

- [ ] **Step 4: Implement `app/src/lib/billing/money.ts`:**

```ts
/** Money is ALWAYS integer cents (EUR). VAT rates are basis points (2300 = 23%). */

export interface VatBreakdown {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** VAT on a net amount, rounded half-up to the cent. */
export function computeVat(netCents: number, vatRateBp: number): VatBreakdown {
  const vatCents = Math.round((netCents * vatRateBp) / 10000);
  return { netCents, vatCents, grossCents: netCents + vatCents };
}

/** 12177 → "€121.77" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
```

- [ ] **Step 5: Implement `app/src/lib/billing/dates.ts`:**

```ts
/**
 * Calendar-date helpers for billing. Dates are 'YYYY-MM-DD' strings representing
 * Europe/Dublin calendar days. Pure string/UTC arithmetic — never local Date
 * parsing (server TZ must not affect billing).
 */

const DUBLIN_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date in Dublin, e.g. '2026-07-21'. */
export function dublinToday(now = new Date()): string {
  return DUBLIN_FMT.format(now); // en-CA gives YYYY-MM-DD
}

export function dublinDayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate(); // month1 is 1-based
}

/**
 * One month after `dateStr`, landing on `anchorDay` clamped to the target
 * month's length (31 → Feb 28/29, Apr 30 …). Passing the anchor separately is
 * what lets a 31st-anchored subscription bounce back to the 31st after
 * February — deriving it from the clamped date would drift permanently.
 */
export function addMonthClamped(dateStr: string, anchorDay: number): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7)); // 1-based
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const day = Math.min(anchorDay, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** String compare works for ISO dates; wrapped for intent. */
export function cmpDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
```

- [ ] **Step 6: Run tests → PASS.** `npx tsx src/lib/billing/helpers.test.ts` → "all assertions passed".

- [ ] **Step 7: Verify the DDL applies.** `cd app && npx tsx -e "import('./src/lib/db/control').then(m => { m.ensureControlTables(); console.log(m.controlSqlite.prepare(\"SELECT name FROM sqlite_master WHERE name LIKE 'billing%' OR name LIKE 'platform%' OR name='tenant_billing' OR name='capture_sessions'\").all()); })"` → lists all 6 new tables. Then `npx tsc --noEmit`.

---

### Task 2: Payment provider abstraction + DevProvider

**Files:**
- Create: `app/src/lib/payments/provider.ts`, `app/src/lib/payments/devProvider.ts`
- Test: `app/src/lib/payments/devProvider.test.ts`

**Interfaces:**
- Produces (used by the engine and capture routes — exact shapes):

```ts
export type ChargeResult =
  | { ok: true; gatewayRef: string }
  | { ok: false; reason: "declined" | "expired_card" | "error"; message: string };

export interface CaptureStart { redirectUrl: string; sessionRef: string }

export interface PaymentProvider {
  name: "dev" | "cardstream";
  createCaptureSession(opts: {
    tenantId: number;
    amountCents: number | null; // null = tokenize-only (update card)
    returnUrl: string;
    sessionRef: string;         // caller-generated; provider embeds it
  }): Promise<CaptureStart>;
  chargeToken(opts: {
    token: string; amountCents: number; currency: "EUR"; invoiceRef: string;
  }): Promise<ChargeResult>;
  refund(gatewayRef: string, amountCents: number): Promise<{ ok: boolean }>;
}
export function getPaymentProvider(): PaymentProvider; // reads PAYMENT_PROVIDER, defaults dev
```

- [ ] **Step 1: Write the failing test** — `app/src/lib/payments/devProvider.test.ts`:

```ts
// Run: npx tsx src/lib/payments/devProvider.test.ts
import assert from "node:assert/strict";
import { devProvider, DEV_TOKENS } from "./devProvider";

const cap = await devProvider.createCaptureSession({
  tenantId: 7, amountCents: 12177, returnUrl: "/billing/activate", sessionRef: "cs_test1",
});
assert.equal(cap.sessionRef, "cs_test1");
assert.equal(cap.redirectUrl, "/dev/pay/cs_test1");

const ok = await devProvider.chargeToken({ token: DEV_TOKENS.ok, amountCents: 12177, currency: "EUR", invoiceRef: "inv_1" });
assert.equal(ok.ok, true);
if (ok.ok) assert.match(ok.gatewayRef, /^dev_/);

const bad = await devProvider.chargeToken({ token: DEV_TOKENS.decline, amountCents: 12177, currency: "EUR", invoiceRef: "inv_2" });
assert.deepEqual(bad, { ok: false, reason: "declined", message: "Card declined (dev token)" });

const unknown = await devProvider.chargeToken({ token: "tok_garbage", amountCents: 1, currency: "EUR", invoiceRef: "inv_3" });
assert.equal(unknown.ok, false);

assert.deepEqual(await devProvider.refund("dev_x", 100), { ok: true });
console.log("devProvider.test.ts: all assertions passed");
```

- [ ] **Step 2: Run → FAIL** (module not found).

- [ ] **Step 3: Implement `app/src/lib/payments/provider.ts`:**

```ts
import "server-only";

/** Result of a merchant-initiated charge on a stored card token. */
export type ChargeResult =
  | { ok: true; gatewayRef: string }
  | { ok: false; reason: "declined" | "expired_card" | "error"; message: string };

export interface CaptureStart {
  redirectUrl: string;
  sessionRef: string;
}

/**
 * Gateway abstraction. Card capture is HOSTED (we redirect the payer to the
 * provider's page and get a token back — no PAN ever touches this codebase).
 * Recurring charges are merchant-initiated (Continuous Authority) on the token.
 */
export interface PaymentProvider {
  name: "dev" | "cardstream";
  createCaptureSession(opts: {
    tenantId: number;
    /** Gross amount to charge on completion; null = save card only. */
    amountCents: number | null;
    returnUrl: string;
    /** Caller-generated capture_sessions.ref — the provider round-trips it. */
    sessionRef: string;
  }): Promise<CaptureStart>;
  chargeToken(opts: {
    token: string;
    amountCents: number;
    currency: "EUR";
    invoiceRef: string;
  }): Promise<ChargeResult>;
  refund(gatewayRef: string, amountCents: number): Promise<{ ok: boolean }>;
}

import { devProvider } from "./devProvider";

/** Active provider. CardstreamProvider is added when CreatePay credentials arrive. */
export function getPaymentProvider(): PaymentProvider {
  const which = process.env.PAYMENT_PROVIDER ?? "dev";
  if (which === "dev") return devProvider;
  throw new Error(`Unknown PAYMENT_PROVIDER: ${which} (cardstream adapter not yet installed)`);
}
```

- [ ] **Step 4: Implement `app/src/lib/payments/devProvider.ts`:**

```ts
import "server-only";
import crypto from "node:crypto";

import type { PaymentProvider, ChargeResult } from "./provider";

/**
 * Dev/mock provider: the "hosted page" is our own /dev/pay/[ref] screen with
 * Approve / Decline buttons. Deterministic tokens let tests and manual QA drive
 * every lifecycle path without any external gateway.
 */
export const DEV_TOKENS = {
  /** Always charges successfully. */
  ok: "tok_dev_ok",
  /** Always declines — simulates a card that fails at renewal. */
  decline: "tok_dev_decline",
} as const;

export const devProvider: PaymentProvider = {
  name: "dev",

  async createCaptureSession({ sessionRef }) {
    return { redirectUrl: `/dev/pay/${sessionRef}`, sessionRef };
  },

  async chargeToken({ token }): Promise<ChargeResult> {
    if (token === DEV_TOKENS.ok) {
      return { ok: true, gatewayRef: `dev_${crypto.randomBytes(8).toString("hex")}` };
    }
    if (token === DEV_TOKENS.decline) {
      return { ok: false, reason: "declined", message: "Card declined (dev token)" };
    }
    return { ok: false, reason: "error", message: `Unknown dev token: ${token}` };
  },

  async refund() {
    return { ok: true };
  },
};
```

- [ ] **Step 5: Run tests → PASS**, then `npx tsc --noEmit`.

---

### Task 3: Billing settings + engine (the state machine)

**Files:**
- Create: `app/src/lib/billing/settings.ts`, `app/src/lib/billing/engine.ts`
- Test: `app/src/lib/billing/engine.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 provider (injected for tests).
- Produces (exact signatures later tasks call):

```ts
// settings.ts
export function getMonthlyPriceCents(): number;           // default 9900
export function getVatRateBp(): number;                   // default 2300
export function setPlatformSetting(key: string, value: string): void;
export function getPlatformSetting(key: string): string | null;

// engine.ts
export type BillingStatus = "pending_payment" | "active" | "past_due" | "suspended" | "cancelled";
export interface TenantBilling { tenantId: number; status: BillingStatus; billingExempt: boolean;
  cardToken: string | null; cardLast4: string | null; cardExpiry: string | null;
  anchorDay: number | null; nextRenewalAt: string | null; failedAttempts: number; }
export function getBilling(tenantId: number): TenantBilling | null;
export function createBillingRow(tenantId: number, opts?: { exempt?: boolean }): void;
export function logEvent(tenantId: number | null, type: string, detail: unknown, actor: string): void;
export function listEvents(tenantId: number, limit?: number): EventRow[];
export function listInvoices(tenantId: number): InvoiceRow[];
export function saveCard(tenantId: number, card: { token: string; last4: string; expiry: string }): void;
export function activateTenant(tenantId: number, chargeRef: string, today?: string): void;
export function runBillingForDate(today: string, deps?: { provider?: PaymentProvider }): Promise<RunSummary>;
export function chargeOutstanding(tenantId: number, actor: string, deps?): Promise<{ ok: boolean; error?: string }>;
export function markPaid(invoiceId: number, actor: string): void;
export function waiveInvoice(invoiceId: number, actor: string): void;
export function compMonths(tenantId: number, months: number, actor: string): void;
export function suspendTenant(tenantId: number, actor: string): void;
export function reactivateTenant(tenantId: number, actor: string): void;   // manual, no charge
export function offboardTenant(tenantId: number, actor: string): { archiveDir: string };
```

**Dunning rule (the heart of it):** first charge attempt on the renewal due date; on failure → status `past_due`, retries scheduled at due+1, due+3, due+7 (`RETRY_OFFSETS = [1, 3, 7]`, `attempt_count` counts ALL attempts, so 4 total). Failure of the 4th attempt → `suspended`. Any success → `paid`, failures reset, status `active`, `next_renewal_at` advanced with `addMonthClamped(periodStart, anchorDay)`.

- [ ] **Step 1: Implement `app/src/lib/billing/settings.ts`** (settings first — the engine reads them):

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";

const DEFAULTS: Record<string, string> = {
  monthly_price_cents: "9900",
  vat_rate_bp: "2300",
  billing_from_email: "billing@clientflow.ie",
  billing_from_name: "ClientFlow Billing",
};

export function getPlatformSetting(key: string): string | null {
  const row = controlSqlite
    .prepare("SELECT value FROM platform_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key] ?? null;
}

export function setPlatformSetting(key: string, value: string): void {
  controlSqlite
    .prepare(
      "INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function getMonthlyPriceCents(): number {
  return Number(getPlatformSetting("monthly_price_cents"));
}
export function getVatRateBp(): number {
  return Number(getPlatformSetting("vat_rate_bp"));
}
```

- [ ] **Step 2: Write the failing engine test** — `app/src/lib/billing/engine.test.ts`. It drives the full lifecycle against a scratch control DB (point the app's data dir at a temp folder via `CLIENTFLOW_DATA_DIR`? No such env exists — instead the test runs against the real dev `data/control.db` using a THROWAWAY tenant row it creates and deletes; the engine takes `today` and a provider as parameters, so no clocks or gateways are involved):

```ts
// Run: npx tsx src/lib/billing/engine.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import { DEV_TOKENS, devProvider } from "../payments/devProvider";
import {
  activateTenant, createBillingRow, getBilling, listInvoices,
  runBillingForDate, saveCard, suspendTenant, reactivateTenant, markPaid,
} from "./engine";

// ── scratch tenant (control row only; no tenant DB needed by the engine) ──
controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'billing-test'").run();
const t = controlSqlite
  .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('billing-test','Billing Test','tenants/billing-test/void.db',1) RETURNING id")
  .get() as { id: number };
const tid = t.id;
const cleanup = () => {
  for (const tbl of ["billing_invoices", "billing_events", "tenant_billing", "capture_sessions"])
    controlSqlite.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(tid);
  controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
};

try {
  // Provision → pending_payment
  createBillingRow(tid);
  assert.equal(getBilling(tid)!.status, "pending_payment");

  // Activation: card saved + first charge succeeded on Jan 31 (anchor-day 31)
  saveCard(tid, { token: DEV_TOKENS.ok, last4: "4242", expiry: "12/28" });
  activateTenant(tid, "dev_first", "2026-01-31");
  let b = getBilling(tid)!;
  assert.equal(b.status, "active");
  assert.equal(b.anchorDay, 31);
  assert.equal(b.nextRenewalAt, "2026-02-28"); // clamped
  let inv = listInvoices(tid);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].status, "paid");
  assert.deepEqual([inv[0].periodStart, inv[0].periodEnd], ["2026-01-31", "2026-02-28"]);

  // Renewal on Feb 28 succeeds → anchor restored to Mar 31
  await runBillingForDate("2026-02-28", { provider: devProvider });
  b = getBilling(tid)!;
  assert.equal(b.status, "active");
  assert.equal(b.nextRenewalAt, "2026-03-31");
  assert.equal(listInvoices(tid).length, 2);

  // Idempotency: same day again → no new invoice, no double charge
  await runBillingForDate("2026-02-28", { provider: devProvider });
  assert.equal(listInvoices(tid).length, 2);

  // Card starts declining → Mar 31 due: attempt 1 fails → past_due, retry Apr 1
  saveCard(tid, { token: DEV_TOKENS.decline, last4: "4242", expiry: "12/28" });
  await runBillingForDate("2026-03-31", { provider: devProvider });
  b = getBilling(tid)!;
  assert.equal(b.status, "past_due");
  inv = listInvoices(tid);
  const due = inv[2];
  assert.equal(due.status, "failed");
  assert.equal(due.attemptCount, 1);
  assert.equal(due.nextAttemptAt, "2026-04-01");

  // Retries: +1 (Apr 1), +3 (Apr 3) fail; a non-retry day does nothing
  await runBillingForDate("2026-04-01", { provider: devProvider });
  assert.equal(listInvoices(tid)[2].nextAttemptAt, "2026-04-03");
  await runBillingForDate("2026-04-02", { provider: devProvider }); // between retries
  assert.equal(listInvoices(tid)[2].attemptCount, 2);
  await runBillingForDate("2026-04-03", { provider: devProvider });
  assert.equal(listInvoices(tid)[2].nextAttemptAt, "2026-04-07");

  // Final retry (+7) fails → suspended
  await runBillingForDate("2026-04-07", { provider: devProvider });
  assert.equal(getBilling(tid)!.status, "suspended");
  assert.equal(listInvoices(tid)[2].attemptCount, 4);

  // Owner fixes the card → admin/auto reactivation path: markPaid on the bad
  // invoice behaves exactly like a successful late charge
  saveCard(tid, { token: DEV_TOKENS.ok, last4: "1111", expiry: "12/29" });
  markPaid(listInvoices(tid)[2].id, "admin:1");
  b = getBilling(tid)!;
  assert.equal(b.status, "active");
  assert.equal(b.failedAttempts, 0);
  assert.equal(b.nextRenewalAt, "2026-04-30"); // period after Mar 31, clamped

  // Manual suspend / reactivate round-trip
  suspendTenant(tid, "admin:1");
  assert.equal(getBilling(tid)!.status, "suspended");
  reactivateTenant(tid, "admin:1");
  assert.equal(getBilling(tid)!.status, "active");

  console.log("engine.test.ts: all assertions passed");
} finally {
  cleanup();
}
```

- [ ] **Step 3: Run → FAIL** (engine missing).

- [ ] **Step 4: Implement `app/src/lib/billing/engine.ts`:**

```ts
import "server-only";

import fs from "node:fs";
import path from "node:path";

import { controlSqlite } from "@/lib/db/control";
import { getPaymentProvider, type PaymentProvider } from "@/lib/payments/provider";
import { computeVat } from "./money";
import { addMonthClamped, addDays, cmpDate, dublinDayOfMonth, dublinToday } from "./dates";
import { getMonthlyPriceCents, getVatRateBp } from "./settings";

/** Retry offsets (days after the due date). 4 attempts total incl. the due-day one. */
const RETRY_OFFSETS = [1, 3, 7] as const;

export type BillingStatus = "pending_payment" | "active" | "past_due" | "suspended" | "cancelled";

export interface TenantBilling {
  tenantId: number; status: BillingStatus; billingExempt: boolean;
  cardToken: string | null; cardLast4: string | null; cardExpiry: string | null;
  anchorDay: number | null; nextRenewalAt: string | null; failedAttempts: number;
}
export interface InvoiceRow {
  id: number; tenantId: number; periodStart: string; periodEnd: string;
  netCents: number; vatCents: number; grossCents: number; vatRateBp: number;
  status: "pending" | "paid" | "failed" | "waived" | "refunded";
  gatewayRef: string | null; attemptCount: number; nextAttemptAt: string | null;
  paidAt: number | null; createdAt: number;
}
export interface EventRow { id: number; tenantId: number | null; type: string; detail: string | null; actor: string; createdAt: number }
export interface RunSummary { charged: number; failed: number; suspended: number }

const rowToBilling = (r: Record<string, unknown>): TenantBilling => ({
  tenantId: r.tenant_id as number,
  status: r.status as BillingStatus,
  billingExempt: Boolean(r.billing_exempt),
  cardToken: (r.card_token as string) ?? null,
  cardLast4: (r.card_last4 as string) ?? null,
  cardExpiry: (r.card_expiry as string) ?? null,
  anchorDay: (r.anchor_day as number) ?? null,
  nextRenewalAt: (r.next_renewal_at as string) ?? null,
  failedAttempts: (r.failed_attempts as number) ?? 0,
});
const rowToInvoice = (r: Record<string, unknown>): InvoiceRow => ({
  id: r.id as number, tenantId: r.tenant_id as number,
  periodStart: r.period_start as string, periodEnd: r.period_end as string,
  netCents: r.net_cents as number, vatCents: r.vat_cents as number,
  grossCents: r.gross_cents as number, vatRateBp: r.vat_rate_bp as number,
  status: r.status as InvoiceRow["status"], gatewayRef: (r.gateway_ref as string) ?? null,
  attemptCount: r.attempt_count as number, nextAttemptAt: (r.next_attempt_at as string) ?? null,
  paidAt: (r.paid_at as number) ?? null, createdAt: r.created_at as number,
});

export function getBilling(tenantId: number): TenantBilling | null {
  const r = controlSqlite.prepare("SELECT * FROM tenant_billing WHERE tenant_id = ?").get(tenantId) as
    | Record<string, unknown> | undefined;
  return r ? rowToBilling(r) : null;
}

export function createBillingRow(tenantId: number, opts?: { exempt?: boolean }): void {
  const exempt = opts?.exempt ? 1 : 0;
  controlSqlite
    .prepare(
      `INSERT INTO tenant_billing (tenant_id, status, billing_exempt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id) DO NOTHING`,
    )
    .run(tenantId, exempt ? "active" : "pending_payment", exempt, Date.now(), Date.now());
  logEvent(tenantId, exempt ? "billing_exempt_created" : "billing_row_created", null, "system");
}

export function logEvent(tenantId: number | null, type: string, detail: unknown, actor: string): void {
  controlSqlite
    .prepare("INSERT INTO billing_events (tenant_id, type, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(tenantId, type, detail == null ? null : JSON.stringify(detail), actor, Date.now());
}

export function listEvents(tenantId: number, limit = 50): EventRow[] {
  return (controlSqlite
    .prepare("SELECT * FROM billing_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ?")
    .all(tenantId, limit) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number, tenantId: (r.tenant_id as number) ?? null, type: r.type as string,
    detail: (r.detail as string) ?? null, actor: r.actor as string, createdAt: r.created_at as number,
  }));
}

export function listInvoices(tenantId: number): InvoiceRow[] {
  return (controlSqlite
    .prepare("SELECT * FROM billing_invoices WHERE tenant_id = ? ORDER BY period_start ASC")
    .all(tenantId) as Record<string, unknown>[]).map(rowToInvoice);
}

export function saveCard(tenantId: number, card: { token: string; last4: string; expiry: string }): void {
  controlSqlite
    .prepare("UPDATE tenant_billing SET card_token = ?, card_last4 = ?, card_expiry = ?, updated_at = ? WHERE tenant_id = ?")
    .run(card.token, card.last4, card.expiry, Date.now(), tenantId);
  logEvent(tenantId, "card_saved", { last4: card.last4 }, "system");
}

const touch = (tenantId: number, sets: string, ...args: unknown[]) =>
  controlSqlite.prepare(`UPDATE tenant_billing SET ${sets}, updated_at = ${Date.now()} WHERE tenant_id = ?`).run(...args, tenantId);

/** Create (idempotently) the invoice for the period starting `periodStart`. */
function ensureInvoice(tenantId: number, periodStart: string, anchorDay: number): InvoiceRow {
  const periodEnd = addMonthClamped(periodStart, anchorDay);
  const { netCents, vatCents, grossCents } = computeVat(getMonthlyPriceCents(), getVatRateBp());
  controlSqlite
    .prepare(
      `INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, period_start) DO NOTHING`,
    )
    .run(tenantId, periodStart, periodEnd, netCents, vatCents, grossCents, getVatRateBp(), Date.now());
  return rowToInvoice(
    controlSqlite
      .prepare("SELECT * FROM billing_invoices WHERE tenant_id = ? AND period_start = ?")
      .get(tenantId, periodStart) as Record<string, unknown>,
  );
}

/** Shared success path: invoice paid → active, failures cleared, renewal advanced. */
function applyPaid(inv: InvoiceRow, gatewayRef: string | null, actor: string): void {
  controlSqlite
    .prepare("UPDATE billing_invoices SET status = 'paid', gateway_ref = COALESCE(?, gateway_ref), paid_at = ?, next_attempt_at = NULL WHERE id = ?")
    .run(gatewayRef, Date.now(), inv.id);
  const b = getBilling(inv.tenantId)!;
  const anchor = b.anchorDay ?? dublinDayOfMonth(inv.periodStart);
  controlSqlite
    .prepare(
      `UPDATE tenant_billing SET status = 'active', failed_attempts = 0, last_failure_at = NULL,
       suspended_at = NULL, next_renewal_at = ?, updated_at = ? WHERE tenant_id = ?`,
    )
    .run(addMonthClamped(inv.periodStart, anchor), Date.now(), inv.tenantId);
  logEvent(inv.tenantId, "charged", { invoiceId: inv.id, grossCents: inv.grossCents, gatewayRef }, actor);
}

/** Shared failure path: schedule next retry or suspend after the last one. */
function applyFailed(inv: InvoiceRow, message: string, actor: string): void {
  const attempts = inv.attemptCount + 1;
  const dueDate = inv.periodStart;
  const nextOffset = RETRY_OFFSETS[attempts - 1]; // attempt 1 → offset[0]=+1 …
  const nextAttemptAt = nextOffset != null ? addDays(dueDate, nextOffset) : null;
  controlSqlite
    .prepare("UPDATE billing_invoices SET status = 'failed', attempt_count = ?, next_attempt_at = ? WHERE id = ?")
    .run(attempts, nextAttemptAt, inv.id);
  controlSqlite
    .prepare("UPDATE tenant_billing SET status = ?, failed_attempts = ?, last_failure_at = ?, suspended_at = ?, updated_at = ? WHERE tenant_id = ?")
    .run(
      nextAttemptAt ? "past_due" : "suspended",
      attempts,
      Date.now(),
      nextAttemptAt ? null : Date.now(),
      Date.now(),
      inv.tenantId,
    );
  logEvent(inv.tenantId, nextAttemptAt ? "charge_failed" : "suspended",
    { invoiceId: inv.id, attempt: attempts, nextAttemptAt, message }, actor);
}

async function attemptCharge(inv: InvoiceRow, provider: PaymentProvider, actor: string): Promise<boolean> {
  const b = getBilling(inv.tenantId);
  if (!b?.cardToken) { applyFailed(inv, "No card on file", actor); return false; }
  const res = await provider.chargeToken({
    token: b.cardToken, amountCents: inv.grossCents, currency: "EUR", invoiceRef: `inv_${inv.id}`,
  });
  if (res.ok) { applyPaid(inv, res.gatewayRef, actor); return true; }
  applyFailed(inv, res.message, actor);
  return false;
}

/** First successful charge (via capture flow): activate + record the paid first period. */
export function activateTenant(tenantId: number, chargeRef: string, today = dublinToday()): void {
  const anchor = dublinDayOfMonth(today);
  touch(tenantId, `status = 'active', anchor_day = ${anchor}, activated_at = ${Date.now()}, next_renewal_at = '${addMonthClamped(today, anchor)}'`, );
  const inv = ensureInvoice(tenantId, today, anchor);
  controlSqlite
    .prepare("UPDATE billing_invoices SET status = 'paid', gateway_ref = ?, paid_at = ? WHERE id = ?")
    .run(chargeRef, Date.now(), inv.id);
  logEvent(tenantId, "activated", { invoiceId: inv.id, chargeRef }, "system");
}

/**
 * The daily billing run. Idempotent: invoices are UNIQUE(tenant_id, period_start)
 * and each retry only fires when next_attempt_at == today.
 */
export async function runBillingForDate(
  today: string,
  deps?: { provider?: PaymentProvider },
): Promise<RunSummary> {
  const provider = deps?.provider ?? getPaymentProvider();
  const summary: RunSummary = { charged: 0, failed: 0, suspended: 0 };

  // 1) Renewals due: active tenants whose next_renewal_at has arrived.
  const due = controlSqlite
    .prepare(
      `SELECT tenant_id, anchor_day, next_renewal_at FROM tenant_billing
       WHERE status = 'active' AND billing_exempt = 0 AND next_renewal_at IS NOT NULL AND next_renewal_at <= ?`,
    )
    .all(today) as Array<{ tenant_id: number; anchor_day: number; next_renewal_at: string }>;
  for (const row of due) {
    const inv = ensureInvoice(row.tenant_id, row.next_renewal_at, row.anchor_day);
    if (inv.status !== "pending") continue; // already handled (idempotency)
    (await attemptCharge(inv, provider, "system")) ? summary.charged++ : summary.failed++;
  }

  // 2) Dunning retries: failed invoices whose retry date has arrived.
  const retries = controlSqlite
    .prepare(
      `SELECT bi.* FROM billing_invoices bi
       JOIN tenant_billing tb ON tb.tenant_id = bi.tenant_id
       WHERE bi.status = 'failed' AND bi.next_attempt_at IS NOT NULL AND bi.next_attempt_at <= ?
         AND tb.status = 'past_due' AND tb.billing_exempt = 0`,
    )
    .all(today) as Record<string, unknown>[];
  for (const r of retries) {
    const inv = rowToInvoice(r);
    const ok = await attemptCharge(inv, provider, "system");
    if (ok) summary.charged++;
    else if (getBilling(inv.tenantId)?.status === "suspended") summary.suspended++;
    else summary.failed++;
  }
  return summary;
}

/** Admin "charge now" / owner reactivation: charge the oldest unpaid invoice. */
export async function chargeOutstanding(
  tenantId: number,
  actor: string,
  deps?: { provider?: PaymentProvider },
): Promise<{ ok: boolean; error?: string }> {
  const provider = deps?.provider ?? getPaymentProvider();
  const r = controlSqlite
    .prepare("SELECT * FROM billing_invoices WHERE tenant_id = ? AND status IN ('pending','failed') ORDER BY period_start ASC LIMIT 1")
    .get(tenantId) as Record<string, unknown> | undefined;
  if (!r) return { ok: false, error: "No outstanding invoice" };
  const ok = await attemptCharge(rowToInvoice(r), provider, actor);
  return ok ? { ok: true } : { ok: false, error: "Charge failed" };
}

export function markPaid(invoiceId: number, actor: string): void {
  const r = controlSqlite.prepare("SELECT * FROM billing_invoices WHERE id = ?").get(invoiceId) as
    | Record<string, unknown> | undefined;
  if (!r) throw new Error("Invoice not found");
  applyPaid(rowToInvoice(r), null, actor);
  logEvent(rowToInvoice(r).tenantId, "marked_paid", { invoiceId }, actor);
}

export function waiveInvoice(invoiceId: number, actor: string): void {
  const r = controlSqlite.prepare("SELECT * FROM billing_invoices WHERE id = ?").get(invoiceId) as
    | Record<string, unknown> | undefined;
  if (!r) throw new Error("Invoice not found");
  const inv = rowToInvoice(r);
  // Waive = forgive the period entirely; same forward motion as a payment.
  applyPaid(inv, null, actor);
  controlSqlite.prepare("UPDATE billing_invoices SET status = 'waived', paid_at = NULL WHERE id = ?").run(invoiceId);
  logEvent(inv.tenantId, "waived", { invoiceId }, actor);
}

export function compMonths(tenantId: number, months: number, actor: string): void {
  const b = getBilling(tenantId);
  if (!b?.nextRenewalAt || !b.anchorDay) throw new Error("Tenant has no active billing cycle");
  let d = b.nextRenewalAt;
  for (let i = 0; i < months; i++) d = addMonthClamped(d, b.anchorDay);
  touch(tenantId, `next_renewal_at = '${d}'`);
  logEvent(tenantId, "comped", { months, newRenewal: d }, actor);
}

export function suspendTenant(tenantId: number, actor: string): void {
  touch(tenantId, `status = 'suspended', suspended_at = ${Date.now()}`);
  logEvent(tenantId, "suspended", { manual: true }, actor);
}

export function reactivateTenant(tenantId: number, actor: string): void {
  touch(tenantId, `status = 'active', failed_attempts = 0, suspended_at = NULL`);
  logEvent(tenantId, "reactivated", { manual: true }, actor);
}

/** Cancel + archive: copy the tenant DB into data/archive/, deactivate the tenant. */
export function offboardTenant(tenantId: number, actor: string): { archiveDir: string } {
  const t = controlSqlite.prepare("SELECT slug, db_file FROM tenants WHERE id = ?").get(tenantId) as
    | { slug: string; db_file: string } | undefined;
  if (!t) throw new Error("Tenant not found");
  const dataDir = path.join(process.cwd(), "data");
  const archiveDir = path.join(dataDir, "archive", `${t.slug}-${dublinToday()}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  const src = path.join(dataDir, t.db_file);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(archiveDir, path.basename(t.db_file)));
  fs.writeFileSync(
    path.join(archiveDir, "manifest.json"),
    JSON.stringify({ tenantId, slug: t.slug, offboardedAt: new Date().toISOString(), invoices: listInvoices(tenantId) }, null, 2),
  );
  touch(tenantId, `status = 'cancelled'`);
  controlSqlite.prepare("UPDATE tenants SET is_active = 0 WHERE id = ?").run(tenantId);
  logEvent(tenantId, "offboarded", { archiveDir }, actor);
  return { archiveDir };
}
```

> **Implementation note for the `touch` helper:** interpolating `Date.now()` into the SQL string is fine (it's a number we control), but the per-call `sets` fragments above also interpolate computed dates/anchors. Those values are always internally generated (never user input) — keep it that way; user-supplied values must go through `?` placeholders.

- [ ] **Step 5: Run the engine test → PASS.** `npx tsx src/lib/billing/engine.test.ts`.
- [ ] **Step 6: Re-run helpers + provider tests, `npx tsc --noEmit` → clean.**

---

### Task 4: Capture flow + gym-facing billing pages + billing gate

**Files:**
- Create: `app/src/lib/billing/capture.ts`, `app/src/lib/billing/emails.ts`
- Create: `app/src/app/api/billing/capture/start/route.ts`, `app/src/app/api/dev-pay/complete/route.ts`
- Create: `app/src/app/dev/pay/[ref]/page.tsx`
- Create: `app/src/app/billing/activate/page.tsx`, `app/src/app/billing/suspended/page.tsx`, `app/src/app/settings/billing/page.tsx`
- Create: `app/src/components/billing/PastDueBanner.tsx`
- Modify: `app/src/app/layout.tsx` (billing gate in the authed-admin branch), `app/src/middleware.ts` (add `/api/dev-pay/` to `PUBLIC_API_PREFIXES` is NOT needed — it requires a session; no middleware change in this task)

**Interfaces:**
- Consumes: engine (`getBilling`, `saveCard`, `activateTenant`, `chargeOutstanding`, `listInvoices`), provider (`getPaymentProvider`), `getMonthlyPriceCents`/`getVatRateBp`, `computeVat`, `formatCents`, `getCurrentMembership` from `@/lib/auth`.
- Produces: `startCapture(tenantId, purpose) → {redirectUrl}` and `completeCapture(ref, outcome) → {returnTo}` in `capture.ts`; `sendBillingEmail(tenantId, kind, data)` in `emails.ts`.

**Billing-gate rule (spec §6):** in the authed-admin layout branch, after membership resolution: read `getBilling(tenant.id)`. No row or `billing_exempt` → no gate. `pending_payment` → redirect everything except `/billing/*` and `/logout` to `/billing/activate`. `suspended` → same but to `/billing/suspended`. `past_due` → render `<PastDueBanner/>` above children. `cancelled` → cannot occur (tenant `is_active=0` blocks login upstream).

- [ ] **Step 1: Implement `app/src/lib/billing/capture.ts`:**

```ts
import "server-only";
import crypto from "node:crypto";

import { controlSqlite } from "@/lib/db/control";
import { getPaymentProvider } from "@/lib/payments/provider";
import { DEV_TOKENS } from "@/lib/payments/devProvider";
import { computeVat } from "./money";
import { getMonthlyPriceCents, getVatRateBp } from "./settings";
import { activateTenant, chargeOutstanding, getBilling, logEvent, saveCard } from "./engine";

export type CapturePurpose = "activate" | "update_card" | "reactivate";

/** Create a capture session + hand back the provider's redirect URL. */
export async function startCapture(
  tenantId: number,
  purpose: CapturePurpose,
): Promise<{ redirectUrl: string }> {
  const ref = `cs_${crypto.randomBytes(12).toString("hex")}`;
  const amountCents =
    purpose === "activate" ? computeVat(getMonthlyPriceCents(), getVatRateBp()).grossCents : null;
  controlSqlite
    .prepare("INSERT INTO capture_sessions (ref, tenant_id, purpose, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(ref, tenantId, purpose, amountCents, Date.now());
  const returnUrl = purpose === "update_card" ? "/settings/billing" : "/dashboard";
  const { redirectUrl } = await getPaymentProvider().createCaptureSession({
    tenantId, amountCents, returnUrl, sessionRef: ref,
  });
  return { redirectUrl };
}

export interface CaptureOutcome {
  ok: boolean;
  token?: string; last4?: string; expiry?: string; chargeRef?: string;
}

/**
 * Apply a finished capture session (called by the dev completion endpoint now,
 * the Cardstream callback later). Idempotent: a non-pending session is a no-op.
 */
export async function completeCapture(ref: string, outcome: CaptureOutcome): Promise<{ returnTo: string }> {
  const s = controlSqlite.prepare("SELECT * FROM capture_sessions WHERE ref = ?").get(ref) as
    | { ref: string; tenant_id: number; purpose: CapturePurpose; amount_cents: number | null; status: string }
    | undefined;
  if (!s) throw new Error("Unknown capture session");
  if (s.status !== "pending") return { returnTo: routeAfter(s.purpose) };

  if (!outcome.ok || !outcome.token) {
    controlSqlite.prepare("UPDATE capture_sessions SET status = 'failed' WHERE ref = ?").run(ref);
    logEvent(s.tenant_id, "capture_failed", { ref, purpose: s.purpose }, "system");
    return { returnTo: routeAfter(s.purpose) };
  }

  saveCard(s.tenant_id, {
    token: outcome.token,
    last4: outcome.last4 ?? "0000",
    expiry: outcome.expiry ?? "12/29",
  });

  if (s.purpose === "activate" && s.amount_cents != null) {
    activateTenant(s.tenant_id, outcome.chargeRef ?? "capture");
  } else if (s.purpose === "reactivate") {
    await chargeOutstanding(s.tenant_id, "system");
  }
  controlSqlite.prepare("UPDATE capture_sessions SET status = 'complete' WHERE ref = ?").run(ref);
  return { returnTo: routeAfter(s.purpose) };
}

function routeAfter(purpose: CapturePurpose): string {
  return purpose === "update_card" ? "/settings/billing" : "/dashboard";
}

export { DEV_TOKENS };
```

- [ ] **Step 2: Implement `app/src/lib/billing/emails.ts`** (platform sender via Resend directly — billing mail must come from ClientFlow, never the gym's own Gmail):

```ts
import "server-only";
import { Resend } from "resend";

import { controlSqlite } from "@/lib/db/control";
import { renderEmailShell, escapeHtml } from "@/lib/email";
import { formatCents } from "./money";
import { getPlatformSetting } from "./settings";

type Kind = "receipt" | "charge_failed" | "suspended" | "reactivated";

/** Email the tenant's OWNER (first admin membership) about a billing event. */
export async function sendBillingEmail(
  tenantId: number,
  kind: Kind,
  data: { grossCents?: number; nextAttemptAt?: string | null; periodStart?: string },
): Promise<void> {
  const owner = controlSqlite
    .prepare(
      `SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = ? AND m.role = 'admin' AND m.is_active = 1 ORDER BY m.id ASC LIMIT 1`,
    )
    .get(tenantId) as { email: string; name: string | null } | undefined;
  const apiKey = process.env.RESEND_API_KEY;
  if (!owner || !apiKey) return; // never let email failures break billing

  const amount = data.grossCents != null ? formatCents(data.grossCents) : "";
  const subjects: Record<Kind, string> = {
    receipt: `Receipt — ClientFlow subscription (${amount})`,
    charge_failed: "Action needed — your ClientFlow payment failed",
    suspended: "Your ClientFlow subscription is paused",
    reactivated: "Your ClientFlow subscription is active again",
  };
  const bodies: Record<Kind, string> = {
    receipt: `<p>Thanks — we've received your subscription payment of <strong>${amount}</strong>.</p><p>You can view invoices any time under Settings → Billing.</p>`,
    charge_failed: `<p>We couldn't take your ClientFlow subscription payment${amount ? ` of <strong>${amount}</strong>` : ""}.</p><p>${
      data.nextAttemptAt ? `We'll retry on <strong>${escapeHtml(data.nextAttemptAt)}</strong>. ` : ""
    }Please check your card under Settings → Billing to avoid interruption.</p>`,
    suspended: `<p>After several failed payment attempts your ClientFlow subscription is paused, and staff access is limited until payment is sorted.</p><p>Sign in and follow the payment screen to reactivate instantly.</p>`,
    reactivated: `<p>Payment received — your ClientFlow subscription is active again. Welcome back!</p>`,
  };

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `${getPlatformSetting("billing_from_name")} <${getPlatformSetting("billing_from_email")}>`,
      to: owner.email,
      subject: subjects[kind],
      html: renderEmailShell({ title: subjects[kind], bodyHtml: bodies[kind] }),
    });
  } catch (err) {
    console.error("[billing] email send failed:", err);
  }
}
```

> **NOTE for implementer:** open `app/src/lib/email.ts` and check `renderEmailShell`'s exact options type (verified to exist; its option names may differ, e.g. `{ title, bodyHtml }` vs `{ heading, contentHtml }`) — match it. Then wire calls into the engine: in `applyPaid` → `sendBillingEmail(tenantId,"receipt",{grossCents})` (fire-and-forget `void …` — but ONLY when `actor === "system"`; skip in tests by leaving emails out of the injected-provider path is NOT possible, so instead: call `void sendBillingEmail(...)` and rely on it returning early without `RESEND_API_KEY`), in `applyFailed` → `"charge_failed"` (or `"suspended"` when no retry remains), in `reactivateTenant`/late-payment success → `"reactivated"`.

- [ ] **Step 3: Capture start route** — `app/src/app/api/billing/capture/start/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentMembership } from "@/lib/auth";
import { getBilling } from "@/lib/billing/engine";
import { startCapture, type CapturePurpose } from "@/lib/billing/capture";

export const dynamic = "force-dynamic";

/** Gym owner starts a card-capture (activate / update card / reactivate). */
export async function POST(req: NextRequest) {
  const m = getCurrentMembership();
  if (!m || m.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { purpose?: CapturePurpose } | null;
  const purpose = body?.purpose;
  if (!purpose || !["activate", "update_card", "reactivate"].includes(purpose)) {
    return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
  }
  const b = getBilling(m.tenant.id);
  if (!b) return NextResponse.json({ error: "Billing not enabled for this account" }, { status: 400 });
  if (purpose === "activate" && b.status !== "pending_payment") {
    return NextResponse.json({ error: "Already activated" }, { status: 400 });
  }
  const { redirectUrl } = await startCapture(m.tenant.id, purpose);
  return NextResponse.json({ ok: true, redirectUrl });
}
```

- [ ] **Step 4: Dev pay page** — `app/src/app/dev/pay/[ref]/page.tsx` (server component + form actions; only renders when `PAYMENT_PROVIDER` is dev):

```tsx
import { notFound, redirect } from "next/navigation";

import { requireUserPage } from "@/lib/auth";
import { controlSqlite } from "@/lib/db/control";
import { formatCents } from "@/lib/billing/money";
import { completeCapture, DEV_TOKENS } from "@/lib/billing/capture";

export const dynamic = "force-dynamic";

/** DEV-ONLY simulated hosted payment page (the DevProvider's "gateway"). */
export default async function DevPayPage({ params }: { params: { ref: string } }) {
  await requireUserPage();
  if ((process.env.PAYMENT_PROVIDER ?? "dev") !== "dev") notFound();
  const s = controlSqlite
    .prepare("SELECT ref, amount_cents, status FROM capture_sessions WHERE ref = ?")
    .get(params.ref) as { ref: string; amount_cents: number | null; status: string } | undefined;
  if (!s || s.status !== "pending") notFound();

  async function decide(formData: FormData) {
    "use server";
    const outcome = String(formData.get("outcome"));
    const { returnTo } = await completeCapture(params.ref, {
      ok: outcome !== "cancel",
      token: outcome === "approve" ? DEV_TOKENS.ok : DEV_TOKENS.decline,
      last4: outcome === "approve" ? "4242" : "0002",
      expiry: "12/29",
      chargeRef: outcome === "approve" ? `dev_cap_${params.ref.slice(-6)}` : undefined,
    });
    redirect(returnTo);
  }

  return (
    <div style={{ maxWidth: 460, margin: "80px auto", padding: 24 }} className="glass">
      <p style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.6 }}>
        Dev payment gateway (simulated)
      </p>
      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>
        {s.amount_cents != null ? `Pay ${formatCents(s.amount_cents)}` : "Save card"}
      </h1>
      <p style={{ opacity: 0.7, fontSize: 13.5 }}>
        No real gateway is configured — choose an outcome to simulate the hosted card page.
      </p>
      <form action={decide} style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button name="outcome" value="approve" className="btn">Approve (card ending 4242)</button>
        <button name="outcome" value="save-failing" className="btn auto">Save a card that declines later</button>
        <button name="outcome" value="cancel" className="btn auto sm">Cancel</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Gym-facing pages.** Follow existing page conventions (server components, `glass` panels, existing `btn` classes; look at `app/src/app/settings/venue/page.tsx` for the settings-page shell pattern).

`app/src/app/billing/activate/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { requireUserPage, getCurrentMembership } from "@/lib/auth";
import { getBilling } from "@/lib/billing/engine";
import { computeVat, formatCents } from "@/lib/billing/money";
import { getMonthlyPriceCents, getVatRateBp } from "@/lib/billing/settings";
import { startCapture } from "@/lib/billing/capture";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activate — ClientFlow" };

export default async function ActivatePage() {
  await requireUserPage();
  const m = getCurrentMembership();
  if (!m) redirect("/login");
  const b = getBilling(m.tenant.id);
  if (!b || b.status !== "pending_payment") redirect("/dashboard");

  const { netCents, vatCents, grossCents } = computeVat(getMonthlyPriceCents(), getVatRateBp());

  async function pay() {
    "use server";
    const mm = getCurrentMembership();
    if (!mm || mm.role !== "admin") redirect("/login");
    const { redirectUrl } = await startCapture(mm.tenant.id, "activate");
    redirect(redirectUrl);
  }

  return (
    <div style={{ maxWidth: 520, margin: "60px auto", padding: 28 }} className="glass">
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>Activate {m.tenant.name}</h1>
      <p style={{ opacity: 0.75, fontSize: 14 }}>
        Your ClientFlow subscription starts today — one flat monthly price, cancel any time.
      </p>
      <div style={{ margin: "20px 0", padding: 16, borderRadius: 12, border: "1px solid var(--hairline, rgba(255,255,255,.1))" }}>
        <Row label="ClientFlow monthly subscription" value={formatCents(netCents)} />
        <Row label="VAT" value={formatCents(vatCents)} />
        <Row label="Due today" value={formatCents(grossCents)} strong />
      </div>
      {m.role === "admin" ? (
        <form action={pay}><button className="btn" style={{ width: "100%" }}>Pay {formatCents(grossCents)} &amp; activate</button></form>
      ) : (
        <p style={{ fontSize: 13.5, opacity: 0.75 }}>Ask your account owner to sign in and complete activation.</p>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontWeight: strong ? 600 : 400 }}>
      <span style={{ opacity: strong ? 1 : 0.75 }}>{label}</span><span>{value}</span>
    </div>
  );
}
```

`app/src/app/billing/suspended/page.tsx` — same shell; heading "Your subscription needs attention"; body: after several failed attempts access is paused; two forms: (a) if a card is on file → server action calling `chargeOutstanding(tenantId, \`tenant:${user.id}\`)` then `redirect(ok ? "/dashboard" : "/billing/suspended?failed=1")`; (b) "Use a different card" → `startCapture(tenantId, "reactivate")` + redirect. Only render actions for `role === "admin"`. If `getBilling().status !== "suspended"` → redirect `/dashboard`.

`app/src/app/settings/billing/page.tsx` — `requireAdminPage()`; shows status chip, card on file (`•••• {last4} · exp {expiry}`), "Update card" (startCapture `update_card`), invoice table from `listInvoices(tenantId)` (period, gross via `formatCents`, status). Mirror table markup from `app/src/app/settings/users/page.tsx`.

`app/src/components/billing/PastDueBanner.tsx`:

```tsx
import Link from "next/link";

export function PastDueBanner() {
  return (
    <div style={{ background: "rgba(242,193,78,.12)", border: "1px solid rgba(242,193,78,.4)", borderRadius: 10, padding: "10px 16px", margin: "0 0 16px", fontSize: 13.5 }}>
      ⚠ Your last subscription payment failed — we'll retry automatically.{" "}
      <Link href="/settings/billing" style={{ textDecoration: "underline" }}>Check your card</Link> to avoid interruption.
    </div>
  );
}
```

- [ ] **Step 6: Dev completion endpoint** is NOT needed as a separate route — the dev pay page's server action calls `completeCapture` directly. Delete `app/src/app/api/dev-pay/complete/route.ts` from scope (leave unbuilt).

- [ ] **Step 7: Billing gate.** In `app/src/app/layout.tsx`, find the authed-admin branch (where the sidebar/chrome renders after membership resolution; it already reads `x-pathname` for the select-account redirect). Add, after membership is resolved:

```tsx
// Billing gate (spec §6): only when a tenant_billing row exists and isn't exempt.
const billing = getBilling(membership.tenant.id);
const path = headersList.get("x-pathname") ?? "/";
if (billing && !billing.billingExempt) {
  const onBilling = path.startsWith("/billing") || path.startsWith("/api/");
  if (billing.status === "pending_payment" && !onBilling) redirect("/billing/activate");
  if (billing.status === "suspended" && !onBilling) redirect("/billing/suspended");
}
const showPastDue = Boolean(billing && !billing.billingExempt && billing.status === "past_due");
```

…and render `{showPastDue ? <PastDueBanner /> : null}` immediately above `{children}` in that branch. (Exact variable names differ — match the file; the layout already resolves membership. `/dev/pay/*` must also be exempted from the redirect: add `path.startsWith("/dev/pay")` to `onBilling`.)

- [ ] **Step 8: Verify manually.** `cd app && npm run dev`, then as an admin of a test tenant with a billing row (create one via `npx tsx -e` calling `createBillingRow`): visiting `/dashboard` redirects to `/billing/activate`; Pay → dev gateway → Approve → `/dashboard` loads; Settings → Billing shows the paid invoice + card `•••• 4242`. `npx tsc --noEmit` clean.

---

### Task 5: Billing cron + scheduler wiring

**Files:**
- Create: `app/src/app/api/cron/billing/route.ts`
- Modify: `app/src/lib/automations/scheduler.ts`

**Interfaces:** Consumes `runBillingForDate` + `dublinToday`. The cron route mirrors `app/src/app/api/cron/daily/route.ts` exactly (same `secretMatches`, same `CRON_SECRET`, same admin fallback).

- [ ] **Step 1: Create `app/src/app/api/cron/billing/route.ts`** — copy `api/cron/daily/route.ts` verbatim, then: import `runBillingForDate` from `@/lib/billing/engine` and `dublinToday` from `@/lib/billing/dates`; replace the `runDailyAutomations()` call with `const result = await runBillingForDate(dublinToday())`; keep `maxDuration = 300`; update the doc comment ("Run the daily platform-billing pass (renewals + dunning)"). The human fallback stays `requireAdmin` — acceptable because the run is idempotent; tighten to `requirePlatformAdmin` (imported from `@/lib/auth`) since billing touches every tenant. Use `requirePlatformAdmin`.

- [ ] **Step 2: Wire into the daily scheduler.** In `app/src/lib/automations/scheduler.ts`, inside `runDailyAutomations()` (after the existing per-tenant work), add a billing pass with its OWN day-claim so a partial failure elsewhere can't skip billing (mirror the existing claim pattern — the file claims a day key via `getCronState`/`setCronState`):

```ts
// Platform billing: renewals + dunning. Own day-claim key, claimed AFTER a
// clean pass (same crash-safety rule as the main claim).
const billingKey = "billing_last_run";
const today = dublinToday();
if (getCronState(billingKey) !== today) {
  try {
    const summary = await runBillingForDate(today);
    setCronState(billingKey, today);
    console.log(`[billing] daily run:`, summary);
  } catch (err) {
    console.error("[billing] daily run failed (will retry on next tick):", err);
  }
}
```

Match the file's existing import style; `dublinToday` may collide with a local helper — alias the import if needed.

- [ ] **Step 3: Verify.** `curl -X POST localhost:3000/api/cron/billing -H "x-cron-secret: $CRON_SECRET"` → `{"ok":true,"charged":0,...}`. Re-run → same (idempotent). `npx tsc --noEmit`.

---

### Task 6: Platform API — auth (service key + platform sessions)

**Files:**
- Create: `app/src/lib/platform/auth.ts`
- Create: `app/src/app/api/platform/auth/login/route.ts`, `app/src/app/api/platform/auth/logout/route.ts`, `app/src/app/api/platform/auth/me/route.ts`
- Modify: `app/src/middleware.ts` (add `"/api/platform/"` to `PUBLIC_API_PREFIXES`, with a comment: "self-authorizes: service key + platform-admin session")
- Test: `app/src/lib/platform/auth.test.ts`

**Interfaces (produced — Task 7's routes call these exactly):**

```ts
export function checkServiceKey(req: Request): boolean;               // x-platform-key vs PLATFORM_API_KEY, constant-time
export function platformLogin(email: string, password: string): { ok: true; token: string; user: { id: number; email: string; name: string | null } } | { ok: false; error: string };
export function requirePlatformSession(req: Request): { userId: number; email: string; name: string | null }; // throws "UNAUTHORIZED"
export function destroyPlatformSession(req: Request): void;
export function guardPlatform(req: Request): { userId: number; email: string; name: string | null } | Response; // key + session in one call
```

- [ ] **Step 1: Failing test** — `app/src/lib/platform/auth.test.ts`:

```ts
// Run: PLATFORM_API_KEY=test-key npx tsx src/lib/platform/auth.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import { hashPassword } from "../auth";
import { checkServiceKey, platformLogin, requirePlatformSession, destroyPlatformSession } from "./auth";

const mkReq = (headers: Record<string, string>) => new Request("http://x/api/platform/x", { headers });

assert.equal(checkServiceKey(mkReq({ "x-platform-key": "test-key" })), true);
assert.equal(checkServiceKey(mkReq({ "x-platform-key": "wrong" })), false);
assert.equal(checkServiceKey(mkReq({})), false);

// Scratch platform-admin user
controlSqlite.prepare("DELETE FROM users WHERE email = 'pa-test@x.ie'").run();
const u = controlSqlite
  .prepare("INSERT INTO users (email, password_hash, role, is_platform_admin) VALUES ('pa-test@x.ie', ?, 'admin', 1) RETURNING id")
  .get(hashPassword("hunter22!")) as { id: number };
try {
  assert.equal(platformLogin("pa-test@x.ie", "nope").ok, false);
  const res = platformLogin("pa-test@x.ie", "hunter22!");
  assert.equal(res.ok, true);
  if (!res.ok) throw new Error("unreachable");
  const sess = requirePlatformSession(mkReq({ "x-admin-session": res.token }));
  assert.equal(sess.userId, u.id);
  assert.throws(() => requirePlatformSession(mkReq({ "x-admin-session": "bogus" })), /UNAUTHORIZED/);
  destroyPlatformSession(mkReq({ "x-admin-session": res.token }));
  assert.throws(() => requirePlatformSession(mkReq({ "x-admin-session": res.token })), /UNAUTHORIZED/);

  // A non-platform-admin cannot log in even with the right password
  controlSqlite.prepare("UPDATE users SET is_platform_admin = 0 WHERE id = ?").run(u.id);
  assert.equal(platformLogin("pa-test@x.ie", "hunter22!").ok, false);
  console.log("platform/auth.test.ts: all assertions passed");
} finally {
  controlSqlite.prepare("DELETE FROM platform_sessions WHERE user_id = ?").run(u.id);
  controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
}
```

- [ ] **Step 2: Run → FAIL.** Then implement `app/src/lib/platform/auth.ts`:

```ts
import "server-only";
import crypto, { timingSafeEqual } from "node:crypto";

import { controlSqlite } from "@/lib/db/control";
import { verifyPassword } from "@/lib/auth";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Constant-time check of the app-to-app service key (x-platform-key). */
export function checkServiceKey(req: Request): boolean {
  const expected = process.env.PLATFORM_API_KEY;
  const provided = req.headers.get("x-platform-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PlatformUser = { userId: number; email: string; name: string | null };

export function platformLogin(
  email: string,
  password: string,
): { ok: true; token: string; user: PlatformUser } | { ok: false; error: string } {
  const u = controlSqlite
    .prepare("SELECT id, email, name, password_hash, is_platform_admin, is_active FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as
    | { id: number; email: string; name: string | null; password_hash: string; is_platform_admin: number; is_active: number }
    | undefined;
  // Uniform failure: never reveal which factor failed.
  const fail = { ok: false as const, error: "Invalid email or password" };
  if (!u || !u.is_active || !u.is_platform_admin) return fail;
  if (!verifyPassword(password, u.password_hash)) return fail;

  const token = crypto.randomBytes(32).toString("hex");
  controlSqlite
    .prepare("INSERT INTO platform_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(token, u.id, Date.now() + SESSION_TTL_MS, Date.now());
  return { ok: true, token, user: { userId: u.id, email: u.email, name: u.name } };
}

export function requirePlatformSession(req: Request): PlatformUser {
  const token = req.headers.get("x-admin-session");
  if (!token) throw new Error("UNAUTHORIZED");
  const row = controlSqlite
    .prepare(
      `SELECT s.user_id, s.expires_at, u.email, u.name, u.is_platform_admin, u.is_active
       FROM platform_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as
    | { user_id: number; expires_at: number; email: string; name: string | null; is_platform_admin: number; is_active: number }
    | undefined;
  if (!row || row.expires_at < Date.now() || !row.is_platform_admin || !row.is_active) {
    throw new Error("UNAUTHORIZED");
  }
  return { userId: row.user_id, email: row.email, name: row.name };
}

export function destroyPlatformSession(req: Request): void {
  const token = req.headers.get("x-admin-session");
  if (token) controlSqlite.prepare("DELETE FROM platform_sessions WHERE token = ?").run(token);
}

/** One-call guard for platform API routes: service key AND session, else a Response. */
export function guardPlatform(req: Request): PlatformUser | Response {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });
  try {
    return requirePlatformSession(req);
  } catch {
    return Response.json({ error: "Session expired" }, { status: 401 });
  }
}
```

- [ ] **Step 3: Run test → PASS** (`PLATFORM_API_KEY=test-key npx tsx src/lib/platform/auth.test.ts`).

- [ ] **Step 4: Auth routes.** `app/src/app/api/platform/auth/login/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { checkServiceKey, platformLogin } from "@/lib/platform/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });
  const rl = rateLimit(`platform-login:${clientIp(req)}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  const res = platformLogin(body.email, body.password);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
  return NextResponse.json(res);
}
```

`logout/route.ts`: `POST` → `checkServiceKey` else 404 → `destroyPlatformSession(req)` → `{ ok: true }`.
`me/route.ts`: `GET` → `const g = guardPlatform(req); if (g instanceof Response) return g; return NextResponse.json({ user: g });`

- [ ] **Step 5: Middleware.** Add `"/api/platform/", // self-authorizes: service key + platform-admin session` to `PUBLIC_API_PREFIXES` in `app/src/middleware.ts`.

- [ ] **Step 6: Verify.** With dev server + `PLATFORM_API_KEY=test-key` in `app/.env.local`: `curl -X POST localhost:3000/api/platform/auth/login -H "x-platform-key: test-key" -H 'Content-Type: application/json' -d '{"email":"<your admin email>","password":"<pw>"}'` → 401 until your user has `is_platform_admin=1` (set it: `npx tsx -e "import('./src/lib/db/control').then(m=>m.controlSqlite.prepare(\"UPDATE users SET is_platform_admin=1 WHERE email='christopher.walshe1994@gmail.com'\").run())"`) → then token returned. Without the key header → 404. `npx tsc --noEmit`.

---

### Task 7: Platform API — overview, tenants, actions, settings + venueType provisioning

**Files:**
- Modify: `app/src/lib/tenants.ts` (venueType + billing row)
- Create: `app/src/lib/platform/queries.ts`
- Create routes under `app/src/app/api/platform/`: `overview/route.ts`, `tenants/route.ts`, `tenants/[id]/route.ts`, `tenants/[id]/[action]/route.ts`, `settings/route.ts`

**Interfaces:**
- Consumes: `guardPlatform`, engine actions, `getTenantDbById` from `@/lib/db/tenant`, `createTenant`/`createTenantAdmin`/`seedTenant`.
- Produces (JSON shapes the admin app consumes — keep field names exactly):

```ts
// GET overview → { mrrCents, counts: Record<BillingStatus, number>, attention: TenantSummary[], events: EventRow[] }
// GET tenants → { tenants: TenantSummary[] }   TenantSummary = { id, slug, name, venueType, isActive, billing: { status, billingExempt, nextRenewalAt, cardLast4 } | null, createdAt }
// GET tenants/:id → { tenant: TenantSummary, usage: { clients: number, staff: number }, invoices: InvoiceRow[], events: EventRow[] }
// POST tenants { name, slug, venueType: "gym"|"clinic", ownerEmail, ownerName? } → { ok, tenantId, tempPassword }
// POST tenants/:id/:action  (suspend|reactivate|charge-now|mark-paid|waive|comp|offboard) body varies → { ok } | { ok:false, error }
// GET/PUT settings → { monthlyPriceCents, vatRateBp, provider }
```

- [ ] **Step 1: `seedTenant` venue branch.** In `app/src/lib/tenants.ts`, change the signature to `seedTenant(sqlite: BetterSqlite3, venueType: "clinic" | "gym" = "clinic")`. Wrap the therapies block in `if (venueType === "clinic") { … }`. Replace the hardcoded `setIf.run("venue_type", JSON.stringify("clinic"))` with `setIf.run("venue_type", JSON.stringify(venueType))`. Make the core tags conditional:

```ts
const coreTags: Array<[string, string, string]> =
  venueType === "gym"
    ? [
        ["Membership", "membership", "#58a6ff"],
        ["Classes", "classes", "#3fb950"],
        ["PT", "pt", "#a855f7"],
        ["Billing", "billing", "#2ed8c3"],
        ["Hours", "hours", "#8b949e"],
        ["Urgent", "urgent", "#f85149"],
        ["Upset", "upset", "#db61a2"],
        ["VIP", "vip", "#d29922"],
      ]
    : [ /* existing clinic list unchanged */ ];
```

- [ ] **Step 2: `createTenant` additions.** Add `venueType?: "clinic" | "gym"` and `billing?: { exempt?: boolean }` to `CreateTenantInput`. Pass `input.venueType ?? "clinic"` to `seedTenant`. After seeding, add:

```ts
// Billing: every provisioned tenant gets a billing row (pending_payment unless exempt).
createBillingRow(tenant.id, { exempt: input.billing?.exempt ?? false });
```

(import `createBillingRow` from `@/lib/billing/engine`). Update the existing `/api/internal/tenants` zod schema to accept optional `venueType: z.enum(["clinic","gym"]).optional()` so the legacy route keeps working.

- [ ] **Step 3: `app/src/lib/platform/queries.ts`:**

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { getMonthlyPriceCents } from "@/lib/billing/settings";

export interface TenantSummary {
  id: number; slug: string; name: string; venueType: string; isActive: boolean;
  createdAt: number;
  billing: { status: string; billingExempt: boolean; nextRenewalAt: string | null; cardLast4: string | null } | null;
}

const SUMMARY_SQL = `
  SELECT t.id, t.slug, t.name, t.is_active, t.created_at,
         b.status AS b_status, b.billing_exempt, b.next_renewal_at, b.card_last4
  FROM tenants t LEFT JOIN tenant_billing b ON b.tenant_id = t.id`;

function toSummary(r: Record<string, unknown>): TenantSummary {
  return {
    id: r.id as number, slug: r.slug as string, name: r.name as string,
    venueType: readVenueType(r.id as number),
    isActive: Boolean(r.is_active), createdAt: r.created_at as number,
    billing: r.b_status
      ? { status: r.b_status as string, billingExempt: Boolean(r.billing_exempt),
          nextRenewalAt: (r.next_renewal_at as string) ?? null, cardLast4: (r.card_last4 as string) ?? null }
      : null,
  };
}

/** venue_type lives in the tenant DB's settings — read defensively. */
function readVenueType(tenantId: number): string {
  try {
    const db = getTenantDbById(tenantId);
    // getTenantDbById returns the drizzle handle; raw is fine via its session —
    // simpler: reopen via openTenantDb? Implementer: use the same accessor other
    // cross-tenant code uses (see scheduler.ts) and SELECT value FROM settings
    // WHERE key='venue_type'. Return JSON.parse(value) or "clinic".
    void db;
    return "clinic";
  } catch { return "unknown"; }
}

export function listTenantSummaries(q?: string): TenantSummary[] {
  const rows = (q
    ? controlSqlite.prepare(`${SUMMARY_SQL} WHERE t.name LIKE ? OR t.slug LIKE ? ORDER BY t.created_at DESC`).all(`%${q}%`, `%${q}%`)
    : controlSqlite.prepare(`${SUMMARY_SQL} ORDER BY t.created_at DESC`).all()) as Record<string, unknown>[];
  return rows.map(toSummary);
}

export function getTenantSummary(id: number): TenantSummary | null {
  const r = controlSqlite.prepare(`${SUMMARY_SQL} WHERE t.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? toSummary(r) : null;
}

export function tenantUsage(id: number): { clients: number; staff: number } {
  const staff = (controlSqlite
    .prepare("SELECT COUNT(*) c FROM memberships WHERE tenant_id = ? AND is_active = 1")
    .get(id) as { c: number }).c;
  let clients = 0;
  try {
    // Implementer: use the established cross-tenant read pattern (scheduler.ts
    // does exactly this) to run: SELECT COUNT(*) c FROM clients
    clients = countClientsViaTenantDb(id);
  } catch { /* tenant DB unreachable → 0 */ }
  return { clients, staff };
}

export function overview() {
  const counts: Record<string, number> = { pending_payment: 0, active: 0, past_due: 0, suspended: 0, cancelled: 0 };
  for (const r of controlSqlite
    .prepare("SELECT status, COUNT(*) c FROM tenant_billing WHERE billing_exempt = 0 GROUP BY status")
    .all() as Array<{ status: string; c: number }>) counts[r.status] = r.c;
  const mrrCents = (counts.active + counts.past_due) * getMonthlyPriceCents();
  const attention = listTenantSummaries().filter(
    (t) => t.billing && !t.billing.billingExempt && ["past_due", "suspended", "pending_payment"].includes(t.billing.status),
  );
  const events = controlSqlite
    .prepare("SELECT * FROM billing_events ORDER BY id DESC LIMIT 30")
    .all();
  return { mrrCents, counts, attention, events };
}
```

> **⚠ Implementer note:** `readVenueType`/`countClientsViaTenantDb` are sketched — open `app/src/lib/automations/scheduler.ts` and reuse ITS cross-tenant DB access idiom verbatim (it iterates tenants and queries each tenant DB). That file is the ground truth for how to get a raw handle per tenant.

- [ ] **Step 4: Routes.** Every handler starts `const g = guardPlatform(req); if (g instanceof Response) return g;` then `const actor = \`admin:${g.userId}\`;`.

`overview/route.ts` — `GET` → `NextResponse.json(overview())`.
`tenants/route.ts` — `GET` (`?q=` → `listTenantSummaries(q)`); `POST` provision:

```ts
const schema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  venueType: z.enum(["gym", "clinic"]),
  ownerEmail: z.string().email(),
  ownerName: z.string().max(120).optional(),
});
// …validate, then:
const tempPassword = crypto.randomBytes(9).toString("base64url"); // ~12 chars
const tenant = createTenant({
  slug: p.slug, name: p.name, venueType: p.venueType,
  admin: { email: p.ownerEmail, password: tempPassword, name: p.ownerName },
});
// Force a first-login password change for the new identity (no-op if reused):
controlSqlite.prepare("UPDATE users SET must_change_password = 1 WHERE email = ? AND last_login_at IS NULL").run(p.ownerEmail.toLowerCase());
logEvent(tenant.id, "provisioned", { by: g.email, venueType: p.venueType }, actor);
// Email the owner their sign-in details via sendBillingEmail-style Resend send
// (subject "Your ClientFlow account is ready", link to APP_URL/login) — reuse
// the platform sender from lib/billing/emails.ts by exporting a generic
// sendPlatformEmail(to, subject, bodyHtml) from that file and calling it here.
return NextResponse.json({ ok: true, tenantId: tenant.id, tempPassword });
```

(Also: export `sendPlatformEmail(to: string, subject: string, bodyHtml: string)` from `lib/billing/emails.ts` — refactor `sendBillingEmail` to use it internally.)

`tenants/[id]/route.ts` — `GET`: 404 if `!getTenantSummary(id)`; else `{ tenant, usage: tenantUsage(id), invoices: listInvoices(id), events: listEvents(id) }`.

`tenants/[id]/[action]/route.ts` — `POST`; parse `params.action`:

```ts
switch (params.action) {
  case "suspend":      suspendTenant(id, actor); break;
  case "reactivate":   reactivateTenant(id, actor); break;
  case "charge-now": { const r = await chargeOutstanding(id, actor); if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 }); break; }
  case "mark-paid": { const b = z.object({ invoiceId: z.number() }).parse(await req.json()); markPaid(b.invoiceId, actor); break; }
  case "waive":     { const b = z.object({ invoiceId: z.number() }).parse(await req.json()); waiveInvoice(b.invoiceId, actor); break; }
  case "comp":      { const b = z.object({ months: z.number().int().min(1).max(12) }).parse(await req.json()); compMonths(id, b.months, actor); break; }
  case "offboard":     offboardTenant(id, actor); break;
  default: return NextResponse.json({ error: "Unknown action" }, { status: 404 });
}
return NextResponse.json({ ok: true });
```

Wrap the switch in try/catch → 400 with the error message.

`settings/route.ts` — `GET`: `{ monthlyPriceCents: getMonthlyPriceCents(), vatRateBp: getVatRateBp(), provider: process.env.PAYMENT_PROVIDER ?? "dev" }`. `PUT`: zod `{ monthlyPriceCents: z.number().int().min(0), vatRateBp: z.number().int().min(0).max(10000) }` → `setPlatformSetting` both → audit event `settings_changed` (tenantId null).

- [ ] **Step 5: Verify with curl** (key + token from Task 6): overview returns counts; `POST tenants` provisions a gym; new tenant DB has NO therapies and `venue_type='gym'`; `GET tenants/:id` shows usage + pending_payment; actions round-trip; settings PUT persists. `npx tsc --noEmit` clean.

---

### Task 8: Seed tool — exempt existing tenants + platform-admin flag

**Files:**
- Create: `tools/seed-billing.cjs` (repo root `tools/`, like `import-site.cjs`)

**Interfaces:** standalone Node script (no Next imports — raw better-sqlite3 against `app/data/control.db`), safe to run repeatedly, runnable locally AND via `railway ssh` in prod.

- [ ] **Step 1: Write `tools/seed-billing.cjs`:**

```js
#!/usr/bin/env node
/**
 * One-time (idempotent) billing bootstrap:
 *  - grants is_platform_admin=1 to the given email
 *  - creates billing_exempt tenant_billing rows for agency-run tenants
 * Usage: node tools/seed-billing.cjs --admin you@example.com [--exempt renova,inspire,clientflow]
 * In prod: run via railway ssh with the app's better-sqlite3 (see Task 13).
 */
const path = require("node:path");
const Database = require(path.join(__dirname, "..", "app", "node_modules", "better-sqlite3"));

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const adminEmail = flag("admin");
const exemptSlugs = (flag("exempt") || "renova,inspire,clientflow").split(",").map((s) => s.trim()).filter(Boolean);
if (!adminEmail) { console.error("Required: --admin <email>"); process.exit(1); }

const dbPath = process.env.CONTROL_DB || path.join(__dirname, "..", "app", "data", "control.db");
const db = new Database(dbPath);
db.pragma("busy_timeout = 15000");

const u = db.prepare("UPDATE users SET is_platform_admin = 1 WHERE email = ?").run(adminEmail.toLowerCase());
console.log(u.changes ? `✓ platform admin: ${adminEmail}` : `⚠ no user found for ${adminEmail}`);

const now = Date.now();
for (const slug of exemptSlugs) {
  const t = db.prepare("SELECT id, name FROM tenants WHERE slug = ?").get(slug);
  if (!t) { console.log(`⚠ tenant not found: ${slug}`); continue; }
  const r = db
    .prepare(
      `INSERT INTO tenant_billing (tenant_id, status, billing_exempt, created_at, updated_at)
       VALUES (?, 'active', 1, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET billing_exempt = 1, status = 'active'`,
    )
    .run(t.id, now, now);
  db.prepare("INSERT INTO billing_events (tenant_id, type, detail, actor, created_at) VALUES (?, 'billing_exempt_created', NULL, 'seed-script', ?)")
    .run(t.id, now);
  console.log(`✓ exempt: ${t.name} (${slug})`, r.changes ? "" : "(already)");
}
db.close();
```

- [ ] **Step 2: Run locally** (dev server must have started once so the billing tables exist): `node tools/seed-billing.cjs --admin christopher.walshe1994@gmail.com` → ✓ lines. Run twice → idempotent. Verify: renova/inspire admins see NO billing gate and NO past-due banner in the app.

---

### Task 9: Admin app scaffold — auth, theme, API client

**Files (all under `admin/`):**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `next-env.d.ts`, `.gitignore`, `.env.local.example`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/login/page.tsx`, `src/app/api/session/route.ts`
- Create: `src/lib/api.ts`, `src/lib/session.ts`

**Interfaces:**
- Produces: `api<T>(path, opts?) → Promise<T>` (server-only; attaches key + session; throws `ApiError` with `.status`), `requireAdminSession() → Promise<{userId,email,name}>` (redirects to `/login` when absent/expired), used by every page in Tasks 10–12.
- Env: `MAIN_APP_URL` (e.g. `http://localhost:3000`), `PLATFORM_API_KEY` (same value as main app).

- [ ] **Step 1: Scaffold.** `admin/package.json`:

```json
{
  "name": "clientflow-admin",
  "private": true,
  "scripts": { "dev": "next dev -p 3100", "build": "next build", "start": "next start -p 3100" },
  "dependencies": { "next": "14.2.35", "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@types/node": "^20", "@types/react": "^18", "typescript": "^5" }
}
```

`tsconfig.json`: copy `app/tsconfig.json` and keep the `@/*` → `./src/*` path alias. `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ]}];
  },
};
export default nextConfig;
```

`.env.local.example`: `MAIN_APP_URL=http://localhost:3000` + `PLATFORM_API_KEY=`. Run `cd admin && npm install`.

- [ ] **Step 2: Theme + root layout.** `src/app/globals.css` — token-driven dark premium (mirror the main app's feel; keep it small):

```css
:root {
  --bg: #0a0d13; --surface: #12161f; --surface-2: #181e2a;
  --line: rgba(255,255,255,.09); --line-2: rgba(255,255,255,.16);
  --text: #e7ecf3; --muted: #98a2b3; --muted-2: #69737f;
  --blue: #2f6bff; --green: #3fb950; --amber: #f2c14e; --red: #f0809a;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.55 system-ui, -apple-system, sans-serif; }
h1, h2, h3 { font-family: var(--font-heading), system-ui, sans-serif; letter-spacing: -.01em; }
a { color: inherit; }
.glass { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
.btn { background: var(--blue); color: #fff; border: none; border-radius: 10px; padding: 9px 16px; font: 600 13.5px/1 system-ui; cursor: pointer; }
.btn.ghost { background: transparent; border: 1px solid var(--line-2); color: var(--text); }
.btn.danger { background: rgba(240,128,154,.15); border: 1px solid var(--red); color: var(--red); }
.input { background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 10px; padding: 9px 12px; color: var(--text); font: 13.5px system-ui; width: 100%; }
.chip { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 11.5px; font-weight: 600; }
.chip.active { background: rgba(63,185,80,.15); color: var(--green); }
.chip.past_due { background: rgba(242,193,78,.15); color: var(--amber); }
.chip.suspended, .chip.cancelled { background: rgba(240,128,154,.15); color: var(--red); }
.chip.pending_payment { background: rgba(47,107,255,.15); color: #9cc4ff; }
.chip.exempt { background: var(--surface-2); color: var(--muted); }
table.tbl { border-collapse: collapse; width: 100%; }
.tbl th { text-align: left; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted-2); font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.tbl td { padding: 11px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
.tbl tr:hover td { background: rgba(255,255,255,.02); }
```

`src/app/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const heading = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading" });

export const metadata = { title: "ClientFlow Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={heading.variable}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: API client** — `src/lib/api.ts`:

```ts
import "server-only";
import { cookies } from "next/headers";

const BASE = process.env.MAIN_APP_URL!;
const KEY = process.env.PLATFORM_API_KEY!;
export const ADMIN_COOKIE = "cf_admin_session";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Server-side call to the main app's platform API (key + session attached). */
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; session?: string | null } = {},
): Promise<T> {
  const session = opts.session === undefined ? cookies().get(ADMIN_COOKIE)?.value ?? null : opts.session;
  const res = await fetch(`${BASE}/api/platform${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "x-platform-key": KEY,
      ...(session ? { "x-admin-session": session } : {}),
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* keep default */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}
```

`src/lib/session.ts`:

```ts
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { api, ApiError, ADMIN_COOKIE } from "./api";

export interface AdminUser { userId: number; email: string; name: string | null }

/** Page guard: verified against /auth/me; redirects to /login when invalid. */
export const requireAdminSession = cache(async (): Promise<AdminUser> => {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) redirect("/login");
  try {
    const { user } = await api<{ user: AdminUser }>("/auth/me");
    return user;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 404)) redirect("/login");
    throw err;
  }
});
```

- [ ] **Step 4: Login page + session route.** `src/app/api/session/route.ts` (the ONLY BFF endpoints — everything else is server components/actions):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { api, ApiError, ADMIN_COOKIE } from "@/lib/api";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  try {
    const res = await api<{ token: string }>("/auth/login", { method: "POST", body, session: null });
    cookies().set(ADMIN_COOKIE, res.token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 7 * 24 * 60 * 60,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : "Sign-in failed";
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* session may be gone */ }
  cookies().delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
```

`src/app/login/page.tsx` — a small client component form: email + password inputs (`.input`), submit → `fetch("/api/session", {method:"POST", …})` → on ok `window.location.href = "/"`; on error show the message inline in `var(--red)`. Centered `glass` card, "ClientFlow Platform" heading, note "Platform admins only."

- [ ] **Step 5: Verify.** Main app running on :3000 with `PLATFORM_API_KEY` set; `cd admin && cp .env.local.example .env.local` (fill in), `npm run dev` → :3100 → log in with your platform-admin credentials → redirected to `/` (404 for now — Task 10 adds it). Wrong password → inline error. `npx tsc --noEmit` in `admin/`.

---

### Task 10: Admin app — shell, dashboard, gyms list

**Files (under `admin/src/`):**
- Create: `app/(console)/layout.tsx`, `app/(console)/page.tsx`, `app/(console)/gyms/page.tsx`
- Create: `components/StatusChip.tsx`, `components/Shell.tsx`, `lib/format.ts`

**Interfaces:** Consumes `api`, `requireAdminSession`, the Task-7 JSON shapes. `lib/format.ts` produces `fmtCents(cents)`, `fmtDate(ms)`, `fmtDay(dateStr)` used by Tasks 10–12.

- [ ] **Step 1: `lib/format.ts`:**

```ts
export const fmtCents = (cents: number) =>
  `€${Math.floor(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
export const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeZone: "Europe/Dublin" }).format(new Date(ms));
export const fmtDay = (d: string | null) => d ?? "—";
```

- [ ] **Step 2: Shell + chip.** `components/Shell.tsx` — top bar ("ClientFlow **Platform**" wordmark, nav links: Dashboard `/`, Gyms `/gyms`, Provision `/provision`, Settings `/settings`, right-aligned email + sign-out button posting DELETE `/api/session` then `location.href="/login"`), then `<main style={{maxWidth: 1100, margin: "0 auto", padding: "28px 20px"}}>{children}</main>`. `components/StatusChip.tsx`:

```tsx
export function StatusChip({ status, exempt }: { status: string | null; exempt?: boolean }) {
  if (!status) return <span className="chip exempt">no billing</span>;
  if (exempt) return <span className="chip exempt">agency</span>;
  const label: Record<string, string> = {
    pending_payment: "awaiting payment", active: "active", past_due: "past due",
    suspended: "suspended", cancelled: "cancelled",
  };
  return <span className={`chip ${status}`}>{label[status] ?? status}</span>;
}
```

`app/(console)/layout.tsx` — `await requireAdminSession()`, wrap children in `<Shell user={…}>`.

- [ ] **Step 3: Dashboard** `app/(console)/page.tsx` — `const data = await api<Overview>("/overview")`; render: 4 stat cards (`MRR` = `fmtCents(data.mrrCents)`, `Active`, `Past due`, `Suspended` from `data.counts`) as `glass` tiles; "Needs attention" table (name, StatusChip, next renewal, link → `/gyms/${id}`) from `data.attention`, or "All quiet ✨" empty state; "Recent events" list (type, actor, `fmtDate(created_at)`).

- [ ] **Step 4: Gyms list** `app/(console)/gyms/page.tsx` — search form (`GET`, `?q=` param passed to `api(\`/tenants?q=…\`)`), `.tbl` table: Name (link `/gyms/${id}`), slug, venue type, StatusChip, next renewal, joined `fmtDate`. Empty state: "No gyms match."

- [ ] **Step 5: Verify** against the dev main app: dashboard shows renova/inspire as `agency` chips; a Task-7-provisioned test gym shows `awaiting payment`; search narrows. `npx tsc --noEmit`.

---

### Task 11: Admin app — gym detail + actions

**Files:**
- Create: `admin/src/app/(console)/gyms/[id]/page.tsx`, `admin/src/app/(console)/gyms/[id]/actions.ts`
- Create: `admin/src/components/ConfirmButton.tsx`

**Interfaces:** Consumes `GET /tenants/:id` shape + `POST /tenants/:id/:action`. Server actions in `actions.ts` produce: `act(id, action, body?)` → calls api, `revalidatePath(\`/gyms/${id}\`)`.

- [ ] **Step 1: `actions.ts`:**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";

export async function tenantAction(
  id: number,
  action: "suspend" | "reactivate" | "charge-now" | "mark-paid" | "waive" | "comp" | "offboard",
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/tenants/${id}/${action}`, { method: "POST", body: body ?? {} });
    revalidatePath(`/gyms/${id}`);
    revalidatePath("/gyms");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Action failed" };
  }
}
```

- [ ] **Step 2: `ConfirmButton.tsx`** (client component) — props `{label, confirm, danger?, action: () => Promise<{ok:boolean;error?:string}>}`; on click `window.confirm(confirm)` → `startTransition(action)` → on `{ok:false}` show inline error; disabled while pending. Offboard uses a typed-confirmation variant: `prompt("Type the gym's slug to archive it")` must equal a `slug` prop.

- [ ] **Step 3: Detail page** `gyms/[id]/page.tsx` — fetch `api<Detail>(\`/tenants/${id}\`)` (404 → `notFound()`). Layout:
  - Header: name + slug + `StatusChip` + venue type; usage line "X members · Y staff".
  - **Billing panel** (`glass`): card on file (`•••• last4 · exp` or "No card"), next renewal, then action buttons wired to `tenantAction`: Charge now (only when an unpaid invoice exists — derive from invoices), Suspend / Reactivate (by status), Comp 1 month (`{months: 1}`).
  - **Invoices table**: period (`periodStart → periodEnd`), `fmtCents(grossCents)` (+ small VAT note), status chip, per-row Mark paid / Waive `ConfirmButton`s for `pending|failed` rows (`{invoiceId}` body).
  - **Events feed**: `type` + `actor` + `fmtDate(createdAt)`, newest first.
  - **Danger zone**: Offboard (typed confirmation) → on success `redirect("/gyms")`.

- [ ] **Step 4: Verify the full loop in dev:** provision test gym → appears `awaiting payment` → (main app) activate via dev gateway → detail shows `active`, paid invoice, card 4242 → save a declining card via Settings → Billing "Update card" → run `curl /api/cron/billing` with a `next_renewal_at` manually set to today (`npx tsx -e` UPDATE) → detail shows `past due`, failed invoice with attempt 1 → Charge now fails (400 surfaced inline) → Mark paid flips it `active` → Suspend/Reactivate round-trip → Offboard archives (check `app/data/archive/`). `npx tsc --noEmit`.

---

### Task 12: Admin app — provision + settings pages

**Files:**
- Create: `admin/src/app/(console)/provision/page.tsx`, `admin/src/app/(console)/provision/actions.ts`
- Create: `admin/src/app/(console)/settings/page.tsx`, `admin/src/app/(console)/settings/actions.ts`

- [ ] **Step 1: Provision.** `actions.ts` — `"use server"` `provisionGym(prev, formData)` (useFormState signature): read name/slug/venueType/ownerEmail/ownerName → `api("/tenants", {method:"POST", body})` → return `{ok:true, tempPassword, name}` or `{ok:false, error}`. `page.tsx` — client form (`useFormState`): Name, Slug (auto-suggest from name on blur: lowercase, spaces→hyphens, strip non `[a-z0-9-]`), Venue type radio (Gym default / Clinic), Owner email, Owner name (optional), submit `.btn` "Create gym". Success state replaces the form: "✓ {name} is live" + the owner email + `tempPassword` in a copyable `<code>` block + note "They'll be asked to change it on first sign-in, then taken to the payment screen." + links "View gym" / "Provision another".

- [ ] **Step 2: Settings.** `page.tsx` — `const s = await api<Settings>("/settings")`; form (server action in `actions.ts` → `PUT /settings` with cents conversion): Monthly price (€ input, `value = s.monthlyPriceCents / 100`, parse with `Math.round(parseFloat(v) * 100)`), VAT rate (% input, `/100` ↔ `*100` for bp), read-only "Payment provider: {provider}" row with a note "CreatePay/Cardstream lands here when credentials arrive." Save button + saved-state feedback. Guard rails: reject NaN/negative before calling the API.

- [ ] **Step 3: Verify:** change price to €149 → main app `/billing/activate` for a fresh pending gym shows €149 + VAT; provision flow end-to-end creates a gym with the temp password shown once. Both apps `npx tsc --noEmit` clean.

---

### Task 13: Deploy + full end-to-end verification

**Files:**
- Create: `admin/railway.json` (build/start config if needed — Railway autodetects Next.js; keep only if defaults fail)
- Modify: none (env vars only)

- [ ] **Step 1: Env vars (main app service).** In Railway → existing service → add `PLATFORM_API_KEY=<openssl rand -hex 32>` and (already present from prior work) `CRON_SECRET`. Leave `PAYMENT_PROVIDER` unset (defaults dev — safe: dev pay page requires an authenticated session and only simulates).

- [ ] **Step 2: Deploy main app.** `cd app && railway up --detach` (existing flow: wait for the new `containerimage.digest`, verify `/login` → 200). Then run the seed via SSH (pattern from prior sessions — base64 node script through `railway ssh`, requiring `/app/node_modules/better-sqlite3` with data dir `/app/data`): run the SQL equivalents of `tools/seed-billing.cjs` (`UPDATE users SET is_platform_admin=1 WHERE email='christopher.walshe1994@gmail.com'` + exempt INSERTs for renova/inspire/clientflow).

- [ ] **Step 3: Create the admin service.** Railway dashboard → New Service → same repo/workflow as the main app but rooted at `admin/` (`railway up` from `admin/` links it) → env: `MAIN_APP_URL=https://clientflow-production-ee94.up.railway.app`, `PLATFORM_API_KEY=<same value>` → deploy → generate domain (Railway subdomain first; `admin.clientflow.ie` CNAME when DNS is ready).

- [ ] **Step 4: Production smoke test (dev provider, zero real money):**
  1. Log into the admin app with your credentials → dashboard shows renova + inspire as `agency`.
  2. Provision "Test Gym" (venue type gym, your email +alias) → chip `awaiting payment`.
  3. Log into the main app as the new owner (temp password → forced change) → land on `/billing/activate` → Pay → dev gateway → Approve → dashboard loads; Settings → Billing shows the paid invoice.
  4. Admin app: gym is `active`, MRR ticked up.
  5. Force a renewal: set `next_renewal_at` to today via SSH, save a declining card (Update card → "Save a card that declines later"), `curl -X POST …/api/cron/billing -H "x-cron-secret: …"` → gym goes `past due`, warning email arrives (if RESEND key live).
  6. Retry to suspension (3 more cron runs with `next_attempt_at` walked forward via SSH, or just Suspend manually) → owner login shows the suspended pay screen → Approve with good card → `active` again.
  7. Offboard the test gym (typed confirmation) → archived in `/app/data/archive/`, login blocked.
  8. Confirm renova/inspire staff experience is completely unchanged throughout.

- [ ] **Step 5: Wrap-up.** Note in the session/memory: CreatePay checklist pending (spec §4); `admin.clientflow.ie` DNS; CardstreamProvider is the only remaining piece for real money.

---

## Self-review (performed at write time)

- **Spec coverage:** §2 architecture → Tasks 6/9; §3 data model → Task 1; §4 provider + questions → Task 2 (+ checklist copied); §5 lifecycle/dunning → Task 3 (test encodes the exact d1/3/7 schedule, month-end clamp, idempotency); §6 enforcement grid → Task 4 Step 7 (client-app row deferred — see Gaps); §7 API surface → Tasks 6–7; §8 console screens → Tasks 10–12; §9 gym-facing → Task 4; §12 rollout → Task 13. Blockers #2/#6/#10 land in Tasks 3/7/11.
- **Known gaps (deliberate):** (1) The client-app (`/app`) gate rows of spec §6 are NOT wired in Task 4 — staff-side gating ships first; add the same `getBilling` check to the client-app layout as a fast follow. (2) `comp` does not create waived invoice rows (event + renewal push only — spec deviation noted). (3) Billing emails fire best-effort and silently no-op without `RESEND_API_KEY`.
- **Type consistency check:** `TenantBilling`/`InvoiceRow`/`EventRow` defined once in engine.ts and re-used by queries/routes; admin app re-declares the JSON shapes in `lib/api.ts` consumers (`TenantSummary`, `Overview`, `Detail`, `Settings`) — implementers define them in `admin/src/lib/types.ts` matching Task 7's route outputs field-for-field.
- **Two sketched functions** (`readVenueType`, `countClientsViaTenantDb` in Task 7) are explicitly delegated to the scheduler.ts idiom with a bolded implementer note — not silent placeholders.


