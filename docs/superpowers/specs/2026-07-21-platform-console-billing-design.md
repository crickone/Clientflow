# Platform Console + Subscription Billing — Design Spec

**Date:** 2026-07-21
**Status:** Approved direction (brainstormed with Christopher); spec pending review
**Covers:** Build 1 (platform-admin backend) + Build 2 (platform subscription billing).
Build 3 (member billing inside tenancies) is a separate future spec that reuses the
payment-provider abstraction defined here.

---

## 1. Goal

Give ClientFlow the two things it cannot launch without:

1. A **separate platform-admin backend** (`admin.clientflow.ie`) to manage gyms:
   provision, inspect, suspend, reactivate, offboard.
2. A **subscription billing system** that charges each gym a **single flat monthly
   price** by card — **no trial, straight to paid** — with automatic retries and
   auto-suspension on failure.

Payment gateway: **CreatePay** (powered by the **Cardstream** white-label gateway API).
No credentials yet (in talks), so everything is built against a provider abstraction
with a fully functional dev/mock provider; the Cardstream adapter drops in later.

This build also closes production-audit blockers **#2** (no billing), **#6** (every
tenant seeded as a wellness clinic), and **#10** (no provisioning/suspend/offboard).

## 2. Architecture

Two deployments, one door to the data:

```
admin.clientflow.ie                    app.clientflow.ie  (existing service)
┌──────────────────────┐               ┌────────────────────────────────────┐
│  admin/  (new app)   │   HTTPS +     │  /api/platform/*   (new API)       │
│  Next.js console UI  │  service key  │  sole owner of control.db +        │
│  no DB, no volume    │ ────────────▶ │  tenant DBs; billing engine,       │
│  BFF route handlers  │               │  cron, provider, emails all here   │
└──────────────────────┘               └────────────────────────────────────┘
  2nd Railway service                     existing Railway service
```

- The admin app **never opens a database**. All reads/writes go through
  `/api/platform/*` on the main app. (SQLite files are local to the main app's node;
  this boundary also survives the Phase-2 Postgres migration untouched.)
- The admin app's **own server routes act as BFF**: the browser only ever talks to
  `admin.clientflow.ie`; the BFF forwards to the platform API adding the service key.
  No CORS surface, service key never reaches a browser.
- The billing engine, payment provider, cron jobs, and email sending all live in the
  **main app** (they need the data and the existing Resend/Gmail plumbing).

### Repo layout

```
<root>/
  app/        ← existing platform (unchanged home of all data + billing engine)
  admin/      ← NEW: standalone Next.js app (console UI only)
  docs/ sites/ tools/ …
```

`admin/` is fully independent (own `package.json`, no workspace coupling). The API is
the contract; response types are defined in `admin/src/lib/api.ts`.

### Auth (two locks on every platform API call)

1. **Service key** — `PLATFORM_API_KEY` env var in both services; sent as
   `x-platform-key`; verified with `timingSafeEqual` (same pattern as the cron route).
   Requests without it are 404-style rejected before any work.
2. **Platform-admin session** — platform admins are control-DB `users` rows with a new
   `is_platform_admin INTEGER DEFAULT 0` flag (only Christopher's user gets it).
   - `POST /api/platform/auth/login` verifies email+password (existing scrypt hashing)
     → creates a row in new control table `platform_sessions` (token, user_id,
     expires_at — same shape as `auth_sessions`) → returns the token.
   - The admin app stores it in an `cf_admin_session` httpOnly/Secure/Lax cookie on the
     admin subdomain and forwards it as `x-admin-session` on every BFF call.
   - Sessions are DB-backed → revocable; 7-day expiry, sliding.
3. Every mutating call writes a `billing_events` audit row with `actor: admin:<userId>`.
4. Optional hardening (documented, not built): IP-allowlist the admin service at the
   edge; the tenant-facing app never serves any admin route.

**Login lockout:** reuse the existing `rateLimit()` helper on the login endpoint.

## 3. Data model (all new tables in `control.db`)

Money is **integer cents, EUR** everywhere. Times are ISO strings, UTC; renewal-day
arithmetic is computed in **Europe/Dublin**.

```sql
CREATE TABLE IF NOT EXISTS tenant_billing (
  tenant_id       INTEGER PRIMARY KEY REFERENCES tenants(id),
  status          TEXT NOT NULL DEFAULT 'pending_payment'
                  CHECK (status IN ('pending_payment','active','past_due','suspended','cancelled')),
  card_token      TEXT,             -- gateway token / cross-reference. NEVER a PAN.
  card_last4      TEXT,
  card_expiry     TEXT,             -- 'MM/YY' display only
  anchor_day      INTEGER,          -- 1–31, day-of-month of first activation
  next_renewal_at TEXT,             -- next charge due (date, Europe/Dublin midnight)
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  activated_at    TEXT,
  suspended_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  period_start  TEXT NOT NULL,      -- inclusive date
  period_end    TEXT NOT NULL,      -- exclusive date
  net_cents     INTEGER NOT NULL,
  vat_cents     INTEGER NOT NULL,
  gross_cents   INTEGER NOT NULL,
  vat_rate_bp   INTEGER NOT NULL,   -- basis points, e.g. 2300 = 23%
  currency      TEXT NOT NULL DEFAULT 'EUR',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','paid','failed','waived','refunded')),
  gateway_ref   TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  paid_at       TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (tenant_id, period_start)  -- idempotency anchor for the billing run
);

CREATE TABLE IF NOT EXISTS billing_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER,
  type       TEXT NOT NULL,   -- provisioned|card_saved|charged|charge_failed|retry_scheduled|
                              -- past_due|suspended|reactivated|comped|marked_paid|offboarded|…
  detail     TEXT,            -- JSON
  actor      TEXT NOT NULL,   -- 'system' | 'admin:<userId>' | 'tenant:<userId>'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key   TEXT PRIMARY KEY,     -- monthly_price_cents | vat_rate_bp | billing_from_email | …
  value TEXT NOT NULL
);
-- users: ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0;
```

**Important — suspension is NOT `tenants.is_active`.** `is_active` stays the manual
kill switch (blocks login entirely — which would lock a suspended owner out of the pay
screen). Billing suspension is `tenant_billing.status = 'suspended'`, enforced by a
billing gate (§6) that still permits login + the billing pages.

## 4. Payment provider abstraction

`app/src/lib/payments/provider.ts`:

```ts
export type ChargeResult =
  | { ok: true; gatewayRef: string }
  | { ok: false; reason: "declined" | "expired_card" | "error"; message: string };

export interface PaymentProvider {
  name: "dev" | "cardstream";
  /** Hosted card-capture (+ optional immediate charge). Returns a redirect URL.
      On completion the gateway calls back with a token; we never see PANs (SAQ-A). */
  createCaptureSession(opts: {
    tenantId: number;
    amountCents: number | null;   // null = tokenize only (update card)
    returnUrl: string;
  }): Promise<{ redirectUrl: string; sessionRef: string }>;
  /** Merchant-initiated recurring charge on a stored token (Continuous Authority). */
  chargeToken(opts: {
    token: string; amountCents: number; currency: "EUR"; invoiceRef: string;
  }): Promise<ChargeResult>;
  refund(gatewayRef: string, amountCents: number): Promise<{ ok: boolean }>;
  /** Verify + parse a capture-session callback into a saved-card result. */
  handleCaptureCallback(req: Request): Promise<{
    sessionRef: string; ok: boolean; token?: string; last4?: string; expiry?: string;
    chargeRef?: string;
  }>;
}
```

- **DevProvider (built now):** `createCaptureSession` redirects to an in-app page
  `/dev/pay/[sessionRef]` (main app, dev/admin-only) showing Succeed / Decline /
  Save-card-that-fails-later buttons. Tokens are `tok_ok` / `tok_decline_next`.
  `chargeToken` succeeds for `tok_ok`, declines for `tok_decline_next`. Lets the whole
  lifecycle (activation → renewals → dunning → suspension → reactivation) be exercised
  end-to-end with zero external dependencies.
- **CardstreamProvider (when CreatePay creds arrive):** hosted payment page for
  capture, CA/MIT charges via stored cross-reference token, signature-verified
  callbacks. Env: `CARDSTREAM_MERCHANT_ID`, `CARDSTREAM_SIGNATURE_KEY`,
  `PAYMENT_PROVIDER=cardstream`.

### Questions for the CreatePay sales conversation (blocking the adapter, not the build)

1. Do we get **gateway/API access** (Cardstream direct API + hosted pages), not just
   terminals/ecommerce plugins?
2. Can our account get a **Continuous Authority MID** for recurring card billing?
3. Is there a **sandbox/test merchant** for integration?
4. Are **signature-verified callbacks/webhooks** available?
5. Is the **Account Updater** service available on our account?
6. Fees: per-transaction rate, monthly gateway fee, settlement timing.

## 5. Billing engine & lifecycle (main app)

State machine (`tenant_billing.status`):

```
pending_payment ──card+first charge ok──▶ active
   active ──renewal charge fails──▶ past_due ──retries fail (d1,d3,d7)──▶ suspended
   past_due ──any retry succeeds──▶ active
   suspended ──pays on reactivation page──▶ active
   any ──offboard──▶ cancelled  (terminal)
```

- **Activation (no trial):** provisioning creates `pending_payment`. Owner's first
  login is gated to `/billing/activate`: shows the price (net + VAT + gross) → hosted
  capture session with immediate first charge → callback saves token + marks invoice
  paid → `active`, `anchor_day` = today's Dublin day-of-month, `next_renewal_at` =
  +1 month.
- **Renewal maths:** same day-of-month as `anchor_day`, clamped to month length
  (31st → Feb 28 / Apr 30). Computed in Europe/Dublin; a shared tested helper —
  explicitly avoiding the audit's `addInterval` overflow bug.
- **Daily billing run:** extends the existing scheduler + a new guarded
  `/api/cron/billing` route (`CRON_SECRET`, same header pattern). For each due tenant:
  create the period invoice (`UNIQUE(tenant_id, period_start)` makes re-runs
  idempotent) → `chargeToken` → on success mark paid, advance `next_renewal_at`,
  receipt email → on failure `past_due`, schedule retry.
- **Dunning:** attempts on due day, +1d, +3d, +7d (4 total). Warning email on each
  failure ("we'll retry on <date>; update your card here"), in-app banner while
  `past_due`. After the final failure → `suspended` + suspension email. All attempts
  recorded on the invoice (`attempt_count`, `next_attempt_at`) and in `billing_events`.
- **Reactivation:** suspended owner logs in → billing gate shows a pay screen (charge
  outstanding invoice with saved card, or update card first) → success → `active`,
  renewal anchor unchanged.
- **Manual admin actions:** charge now · mark paid (offline payment) · waive invoice ·
  comp N months (advances `next_renewal_at`, `waived` invoice rows) · suspend ·
  reactivate · offboard. Every action → audit event.

## 6. Enforcement in the main app (billing gate)

In the authed-admin layout (and client-app layout), after tenant resolution, read the
tenant's `tenant_billing.status` from control:

| status            | Staff app                                             | Client app (/app) |
|-------------------|-------------------------------------------------------|-------------------|
| `pending_payment` | Only `/billing/*` reachable; everything redirects there | Blocked ("not yet active") |
| `active`          | Normal                                                | Normal            |
| `past_due`        | Normal + persistent warning banner                    | Normal            |
| `suspended`       | Only `/billing/*` (pay/reactivate screen)             | Friendly "temporarily unavailable" screen |
| `cancelled`       | Login blocked (tenant offboarded)                     | Blocked           |

Renova + Inspire (agency-run tenants) are seeded `active` with `waived` invoices —
never charged, no gate impact.

## 7. Platform API surface (main app, `/api/platform/*`)

All routes require service key + admin session (except `auth/login`, service key only).
Middleware: add `/api/platform/` to the public-API prefixes (it does its own auth; no
tenant cookie semantics — handlers use explicit control-DB access + `getTenantDbById`,
never the request-scoped `db` proxy).

```
POST /api/platform/auth/login        {email,password} → {token,user}   (rate-limited)
POST /api/platform/auth/logout
GET  /api/platform/overview          → MRR, status counts, needs-attention, recent events
GET  /api/platform/tenants?q=        → list: name, slug, venueType, status, nextRenewal, createdAt
POST /api/platform/tenants           → provision {name, slug, venueType, ownerEmail}
GET  /api/platform/tenants/:id       → detail: usage (clients/staff/last-activity), billing, invoices, events
POST /api/platform/tenants/:id/suspend | reactivate | charge-now | mark-paid | waive | comp | offboard
GET  /api/platform/settings          → monthly price, VAT rate, provider name
PUT  /api/platform/settings
```

- **Provision** calls the existing atomic internal tenant-creation logic, now with
  `venueType` threaded through (`gym` → `venue_type='gym'`, gym tags, **no Renova
  therapies**; `clinic` → current behaviour). Creates the owner user + membership,
  `tenant_billing` row (`pending_payment`), sends the invite email. Closes blocker #6.
- **Offboard:** export bundle (tenant DB file copy + JSON manifest) written to
  `data/archive/<slug>-<date>/` → `tenant_billing.status='cancelled'` →
  `tenants.is_active=0`. DB file archived, not deleted (manual purge policy for now).
- **Usage stats** are read via `getTenantDbById(tenantId)` (existing safe path for
  cross-tenant platform work).

## 8. Admin console (`admin/` app) — screens

Dark-premium, token-driven theme consistent with ClientFlow (Space Grotesk headings);
desktop-first, minimal dependencies.

1. **Login** — email + password.
2. **Dashboard** — MRR, gyms by status (active / past-due / suspended / pending),
   needs-attention list (failed charges, gyms pending payment > 7 days), recent
   billing events feed.
3. **Gyms** — searchable table: name, venue type, status chip, next renewal, joined.
4. **Gym detail** — header (name, slug, status, quick actions) + tabs:
   - *Overview:* clients/staff counts, last activity, venue type.
   - *Billing:* card on file (last4/expiry), next renewal, invoice table
     (period, gross, status, attempts), actions (charge now, mark paid, waive, comp,
     suspend, reactivate).
   - *Events:* audit trail.
   - *Danger zone:* offboard (typed-confirmation).
5. **Provision gym** — form: name, slug (auto from name), venue type (gym/clinic),
   owner email → success screen with invite status.
6. **Settings** — monthly price, VAT rate, provider (dev/cardstream) status.

## 9. Gym-facing additions (main app)

- **`/billing/activate`** — first-login activation: price breakdown → pay by card
  (capture session) → success → into the app.
- **Settings → Billing** — status, card on file + "Update card" (tokenize-only capture
  session), invoice/receipt history.
- **Suspension screen** — friendly, non-shaming: "Your ClientFlow subscription needs
  attention" + pay/update-card actions.
- **Past-due banner** — dismissible per-session, links to Settings → Billing.
- **Emails** (existing plumbing, platform sender): receipt, payment-failed (per retry,
  with next-retry date), suspension notice, reactivation confirmation.

## 10. Security notes

- No PANs ever touch ClientFlow servers (hosted capture only) → SAQ-A posture.
- `PLATFORM_API_KEY` + admin session double-lock; sessions revocable in control.db.
- Platform API handlers never use the cookie-resolved `db` proxy (audit TEN-class
  bug avoidance by construction).
- All mutations audit-logged with actor.
- Admin app has no database, no secrets beyond `PLATFORM_API_KEY` + `MAIN_APP_URL`,
  and can be IP-allowlisted as a later hardening step.

## 11. Explicitly out of scope (this build)

- Member billing inside tenancies (Build 3 — reuses `PaymentProvider`).
- Plan tiers, feature gating, usage metering (flat price only).
- Self-serve public signup (provisioning is via the console; public signup can come
  after CreatePay is live).
- Cardstream adapter implementation (interface + dev provider now; adapter when
  credentials arrive).
- Automated deletion of archived tenant data (manual purge policy).

## 12. Rollout

1. Ship the platform API + control-DB tables + billing engine with `PAYMENT_PROVIDER=dev`.
2. Ship the admin app as a second Railway service; verify login, provisioning a test
   gym end-to-end (activate via DevProvider, force a failed renewal, watch dunning →
   suspension → reactivation).
3. Seed Renova + Inspire as `active`/waived.
4. When CreatePay credentials arrive: implement CardstreamProvider against their
   sandbox, flip `PAYMENT_PROVIDER=cardstream`, run a real €-test charge, then
   provision the first paying gym.
