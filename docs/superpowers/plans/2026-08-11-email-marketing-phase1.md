# Email Marketing (GHL-style) — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship the Phase-1 email marketing MVP from `docs/superpowers/specs/2026-08-11-email-marketing-phase1-design.md`: import contacts → connect + verify a Mailgun sending domain → build a campaign → send it to a segment from the tenant's own domain, metered against a prepaid credit balance, unsubscribe-compliant, with events tracked back into stats. Platform admin sets the price + allocates credits.

**Architecture:** Platform-owned Mailgun behind a swappable `CampaignSender` adapter (subaccount-ready). Credits are a control-plane ledger mirroring `ai/usage.ts`. Contacts/campaigns/sends/suppressions/domains are per-tenant tables. Marketing is a SEPARATE stream from transactional email (Resend/gmail/imap) — campaigns never use the transactional cascade.

**Tech Stack:** Next.js 14 App Router, better-sqlite3 + Drizzle, Mailgun HTTP API via raw `fetch` (NO SDK — avoids bundling/tracing), AES via existing crypto, `renderEmailShell` for bodies.

## Global Constraints

- **Money safety.** All credit reads/writes go through `lib/email/credits.ts` (control plane). Bracket every send: `assertCreditsAvailable(tenantId, cents)` BEFORE, `recordCreditSpend(tenantId, cents, campaignId)` AFTER — the exact pattern `ai/usage.ts` uses (`assertUnderCap`/`recordUsage`). Setters self-validate bounds (like `setTenantCapCents`). **CreatePay is in dev → NEVER charge a card.** Auto-top-up computes the amount, writes a ledger intent, and (only if the platform admin pre-allocated) grants credits; the real charge is a clearly-marked `// TODO(createpay)` hook that stays inert until CreatePay ships.
- **Server-action security** (the account-takeover lesson). Management actions call `requireAdmin()`; `tenantId` is ALWAYS `getCurrentMembership()!.tenant.id`, never from input. No `"use server"` file exports a non-action helper taking a caller tenantId/credential. Platform (admin-console) writes go through `guardPlatform` routes.
- **Public routes self-authorize.** `/u/[token]` (unsubscribe) trusts ONLY a signed token; `/api/mailgun/webhook` trusts ONLY a verified Mailgun signature. Both are allow-listed in `middleware.ts`. The webhook resolves the tenant from `sending_domains`/the event's message metadata — NEVER a default-tenant shortcut.
- **Tenant isolation.** In-request writes use the `db` proxy; background/webhook/detached writes use `getTenantDbById(tenantId)` (or `runWithTenant`). A campaign send must only ever touch its own tenant's tables.
- **Compliance (hard gates).** Every campaign email MUST carry a `List-Unsubscribe` + `List-Unsubscribe-Post` header AND a visible footer unsubscribe link AND the business's identity (name + address). `suppressions` is a hard gate at send time. Only `status='subscribed'` contacts are sent. Bounce/complaint/unsubscribe → irreversible suppression.
- **Deliverability.** Batch sends are throttled (sleep between batches, bail on sustained provider throttling — mirror `scheduler.ts:120-147`). Per-tenant complaint-rate + hard-bounce-rate monitoring auto-pauses a tenant that exceeds thresholds (protects the shared account).
- **Never-throw** from sender/credit/webhook/send-pipeline paths — typed `{ok}|{ok:false,error}` results.
- **Adapter is subaccount-ready.** `CampaignSender` methods take the tenant's `fromDomain`; a Mailgun subaccount id can be threaded later without changing call sites.
- **Mailgun via `fetch`.** No `mailgun.js` dependency. API key + signing key + region from env (`MAILGUN_API_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_REGION` default `us`). Fail closed (typed error) when unset.

---

## Task 1: Credit ledger + pricing (control plane)

**Files:**
- Modify: `app/src/lib/db/schema.ts` (add `emailCreditLedger` Drizzle table)
- Modify: `app/src/lib/db/control.ts` (`ensureControlTables`: `email_credits` + `email_credit_ledger` DDL)
- Create: `app/src/lib/email/credits.ts`
- Test: `app/src/lib/email/credits.test.ts`

**Interfaces (Produces):**
```ts
export const EMAIL_PRICE_KEY = "email_credit_price_cents";   // platform_settings key
export const DEFAULT_EMAIL_PRICE_PER_1000_CENTS = 200;       // €2.00 / 1000 (~5x Mailgun cost)
export function getEmailPricePer1000Cents(): number;         // platform_settings, falls back to default
export function setEmailPricePer1000Cents(cents: number): void; // bounds-check ≥0, ≤10_000
export function costForRecipients(n: number): number;        // ceil(n * price / 1000), in cents
export function getEmailBalanceCents(tenantId: number): number;         // email_credits.balance_cents ?? 0
export function getAutoTopup(tenantId: number): { enabled: boolean; thresholdCents: number; amountCents: number };
export function setAutoTopup(tenantId: number, cfg: { enabled: boolean; thresholdCents: number; amountCents: number }): void;
export class EmailCreditsError extends Error {}
export function assertCreditsAvailable(tenantId: number, cents: number): void; // throws EmailCreditsError if balance < cents
export function grantCredits(tenantId: number, cents: number, actor: string, reason?: "topup"|"adjustment"|"auto_topup"): void; // +balance + ledger row
export function recordCreditSpend(tenantId: number, cents: number, campaignId: number, actor: string): void; // -balance + ledger row (reason 'send')
export function listLedger(tenantId: number, limit?: number): LedgerRow[];
```

**Control tables** (in `ensureControlTables`, mirror `ai_usage`/`tenant_ai_cap` at control.ts L405-432):
```sql
CREATE TABLE IF NOT EXISTS email_credits (
  tenant_id INTEGER PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  auto_topup_enabled INTEGER NOT NULL DEFAULT 0,
  auto_topup_threshold_cents INTEGER NOT NULL DEFAULT 0,
  auto_topup_amount_cents INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE TABLE IF NOT EXISTS email_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  delta_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,          -- 'topup'|'send'|'adjustment'|'refund'|'auto_topup'
  campaign_id INTEGER,
  balance_after_cents INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_email_credit_ledger_tenant ON email_credit_ledger(tenant_id, created_at);
```
`email_credit_ledger` also gets a Drizzle def in schema.ts (it's queried richly). `email_credits` is fine as raw-SQL (tenant_billing style). Balance mutations MUST be a single SQLite transaction (read balance → write balance → insert ledger row with `balance_after`) so concurrent sends can't corrupt the balance. Use `controlSqlite.transaction(...)`.

**Test:** grant→balance rises + ledger row with correct `balance_after`; `assertCreditsAvailable` passes/throws at the boundary; `recordCreditSpend` decrements + ledger `reason='send'`; `costForRecipients` rounding (1→€0.002→ceil to 1 cent? define: cents = `Math.ceil(n * pricePer1000 / 1000)`; test 1, 500, 1000, 1001); price setter bounds. Scratch tenant + `finally` cleanup (ref `apiKeys.test.ts`).

---

## Task 2: Contacts + suppressions model + CSV import

**Files:**
- Modify: `app/src/lib/db/schema.ts` (+ `contacts`, `suppressions`)
- Modify: `app/src/lib/db/tenant.ts` (`ensureTenantTables`: DDL + indexes)
- Create: `app/src/lib/marketing/contactImport.ts` (pure helpers — mirror `lib/memberImport.ts`)
- Create: `app/src/app/campaigns/contacts/import/actions.ts` (`importContactsAction`)
- Create: `app/src/app/campaigns/contacts/page.tsx` (list) + `app/src/components/campaigns/ContactImportWizard.tsx` (mirror `ImportWizard.tsx`)
- Test: `app/src/lib/marketing/contactImport.test.ts`

**Tenant tables:**
```sql
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT, phone TEXT,
  tags TEXT,                       -- JSON string[]
  status TEXT NOT NULL DEFAULT 'subscribed', -- subscribed|unsubscribed|bounced|complained|cleaned
  source TEXT,
  subscribed_at INTEGER, unsubscribed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON contacts(lower(email));
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE TABLE IF NOT EXISTS suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,            -- unsubscribe|bounce|complaint|manual
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions(lower(email));
```

**`contactImport.ts`** mirrors `memberImport.ts` (parseCsv/suggestMapping/mapRow/validateRow/normalizeEmail/dedupeKey) but fields = `email`(required) | `name` | `phone` | `tags`; dedupe key = email only. **`importContactsAction`** mirrors `importMembersAction` (`app/src/app/clients/import/actions.ts`): `requireAdmin`, re-parse (never trust client), MAX_ROWS cap, build email-set from `db.select({email}).from(contacts)`, skip anything in `suppressions`, insert new as `status='subscribed'`, report `{inserted, duplicates, invalid, suppressedSkipped}`.

**Test:** the pure helpers (parse a small CSV, mapping suggestion, dedupe by email, invalid-email rejection). Import action itself covered by review (mirrors a reviewed action).

---

## Task 3: `CampaignSender` adapter + Mailgun + sending-domain connect

**Files:**
- Modify: `app/src/lib/db/schema.ts` + `tenant.ts` (+ `sending_domains`)
- Create: `app/src/lib/marketing/sender/types.ts` (`CampaignSender` interface)
- Create: `app/src/lib/marketing/sender/mailgun.ts` (`MailgunSender` via fetch)
- Create: `app/src/lib/marketing/sender/index.ts` (`getCampaignSender`)
- Create: `app/src/lib/marketing/domains.ts` (per-tenant domain CRUD + verify)
- Create: `app/src/app/campaigns/domains/actions.ts` + `app/src/app/campaigns/domains/page.tsx` + `app/src/components/campaigns/DomainConnectCard.tsx`
- Test: `app/src/lib/marketing/sender/mailgun.test.ts` (pure helpers: event parsing, signature verify)

**Interfaces:**
```ts
// types.ts — subaccount-ready (fromDomain per call; a subaccount id can join opts later)
export interface CampaignMessage { to: string; toName?: string; subject: string; html: string; text?: string; headers?: Record<string,string>; tags?: string[]; }
export interface CampaignSendResult { ok: true; providerId: string } | { ok: false; error: string };
export interface DomainStatus { state: "unverified"|"verified"|"failed"; dnsRecords: { type: string; name: string; value: string }[]; }
export interface MailgunEvent { event: "delivered"|"failed"|"complained"|"unsubscribed"|"opened"|"clicked"; recipient: string; messageId: string; severity?: "temporary"|"permanent"; campaignId?: number; tenantId?: number; }
export interface CampaignSender {
  registerDomain(domain: string): Promise<{ ok: true; id: string; dnsRecords: DomainStatus["dnsRecords"] } | { ok: false; error: string }>;
  getDomainStatus(domain: string): Promise<{ ok: true; status: DomainStatus } | { ok: false; error: string }>;
  send(fromDomain: string, from: { name: string; email: string }, msg: CampaignMessage): Promise<CampaignSendResult>;
}
export function verifyMailgunSignature(timestamp: string, token: string, signature: string): boolean; // HMAC-SHA256(signing key, timestamp+token), timingSafeEqual (mirror secretMatches, blueprint §6)
export function parseMailgunEvent(payload: unknown): MailgunEvent | null; // pull event/recipient/message-id/user-variables{campaignId} from Mailgun's webhook JSON
```
`MailgunSender` calls Mailgun's HTTP API with `fetch` + Basic auth (`api:${MAILGUN_API_KEY}`), base `https://api.${region}.mailgun.net/v3` (region us/eu). `send` posts to `/{fromDomain}/messages` (form-encoded), injects `v:campaignId`/`v:contactId` user-variables (so webhooks can resolve them) and the caller's `List-Unsubscribe`/`h:` headers. Never throws → typed result. `registerDomain`/`getDomainStatus` hit `/domains`.

`sending_domains` tenant table: `domain`, `state`, `dns_records` (JSON), `verified_at`, `created_at`; one active domain per tenant (unique). **`domains.ts`**: `getSendingDomain(tenantId)`, `connectDomain(tenantId, domain)` (calls `registerDomain`, stores unverified + records), `refreshDomainStatus(tenantId)` (calls `getDomainStatus`, flips to verified). **Actions** `requireAdmin` + server-derived tenant. **UI** `DomainConnectCard` mirrors `ImapConnectCard` shape (enter domain → show DNS records → "Check verification" polls).

**Test:** `verifyMailgunSignature` (good/bad/length-mismatch), `parseMailgunEvent` (delivered/failed-permanent→bounce/complained/unsubscribed, missing fields → null). Network paths covered by review + live test (needs a Mailgun key).

---

## Task 4: Campaign model + builder + AI draft

**Files:**
- Modify: `schema.ts` + `tenant.ts` (+ `email_campaigns`, `campaign_sends`)
- Create: `app/src/lib/ai/draftCampaign.ts` (mirror `draftBlog.ts`)
- Create: `app/src/lib/marketing/campaigns.ts` (CRUD + audience resolve)
- Create: `app/src/app/campaigns/page.tsx` (list), `app/src/app/campaigns/new/page.tsx` + `[id]/page.tsx`, `app/src/components/campaigns/CampaignEditor.tsx`
- Create: `app/src/app/campaigns/actions.ts`
- Test: `app/src/lib/marketing/campaigns.test.ts` (audience resolve + create)

**Tenant tables:**
```sql
CREATE TABLE IF NOT EXISTS email_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, subject TEXT NOT NULL, preheader TEXT,
  from_name TEXT NOT NULL, from_email TEXT NOT NULL,
  body_html TEXT NOT NULL,
  audience TEXT NOT NULL,           -- JSON {kind:'all_subscribed'} | {kind:'tag', tag:'...'}
  status TEXT NOT NULL DEFAULT 'draft', -- draft|sending|sent|paused|failed
  cursor INTEGER NOT NULL DEFAULT 0, -- resume offset for throttled send
  stats TEXT,                        -- JSON counts
  scheduled_at INTEGER, sent_at INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE TABLE IF NOT EXISTS campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL, contact_id INTEGER, email TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|sent|delivered|bounced|complained|opened|clicked|unsubscribed|failed
  error TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_msgid ON campaign_sends(provider_message_id);
```
`campaigns.ts`: `createCampaign`, `getCampaign`, `listCampaigns`, `updateCampaign` (draft only), `resolveAudience(campaign): contactIds/emails` (from `contacts` where `status='subscribed'` AND (all | tag in tags)). `draftCampaign.ts` mirrors `draftBlogPost` (system rules const → `getBusinessContext()` → single Anthropic `MODELS.opus` call) returning `{content, usage}`; the CALLER brackets it with `assertUnderCap`/`recordUsage` (blueprint §1/§11). `CampaignEditor` composes subject + preheader + AI-draft body (→ `textToParagraphs` → `renderEmailShell`) + audience picker; save as draft. Actions `requireAdmin` + server-derived tenant.

**Test:** `resolveAudience` (all-subscribed excludes unsubscribed/suppressed; tag filter), campaign create/draft update.

---

## Task 5: Send pipeline (pre-send checks + throttled batch + credit gating + suppression + unsubscribe headers)

**Files:**
- Create: `app/src/lib/marketing/send.ts` (the pipeline)
- Modify: `app/src/app/campaigns/actions.ts` (`sendCampaignAction`)
- Test: `app/src/lib/marketing/send.test.ts`

**Interface:**
```ts
export async function precheckCampaign(tenantId: number, campaignId: number): Promise<{ ok: true; recipients: number; costCents: number } | { ok: false; error: string }>;
// verifies: domain verified, from_email on that domain, unsubscribe token derivable, recipients>0, balance ≥ cost.
export async function runCampaignSend(tenantId: number, campaignId: number): Promise<void>;
// throttled batch (mirror scheduler.ts:120-147): resolve audience → filter out suppressions/non-subscribed → for each: build message (inject List-Unsubscribe header + footer link via unsubscribe token from Task 6) → sender.send → write campaign_sends row → advance cursor. Decrement credits per successfully-queued email (recordCreditSpend). Sleep between batches; bail on sustained provider throttling; set status sending→sent. Uses getTenantDbById(tenantId) (background-safe).
```
`sendCampaignAction` (`requireAdmin`, server-derived tenant): run `precheckCampaign`; if ok, set status `sending`, then kick `runCampaignSend` as a detached `void runWithTenant(tenantId, () => runCampaignSend(...))` continuation (blueprint §8) so the request returns immediately. Credits: reserve/charge per email as sent (not all-up-front) so a mid-run failure doesn't overcharge; `assertCreditsAvailable` re-checked each batch (pause campaign + flag if it runs dry).

**Test:** the suppression/subscribed filter (suppressed + unsubscribed excluded); the per-email cost decrement; precheck failures (no domain, insufficient credits). Mock the sender (inject a fake `CampaignSender`). No live Mailgun.

---

## Task 6: Unsubscribe (signed token + public route + suppression)

**Files:**
- Create: `app/src/lib/marketing/unsubscribeToken.ts` (HMAC-signed, no DB round-trip)
- Create: `app/src/app/u/[token]/route.ts` (public) + a tiny confirmation page/response
- Modify: `app/src/middleware.ts` (allow-list `/u/` prefix — mirror the `/f/` handling, blueprint §5)
- Modify: `app/src/lib/marketing/send.ts` (inject the unsubscribe link + `List-Unsubscribe`/`List-Unsubscribe-Post` headers per recipient)
- Create: `app/src/lib/marketing/suppress.ts` (`suppress(tenantId, email, reason)` — upsert suppression + set contact status; used by unsubscribe + webhook)
- Test: `app/src/lib/marketing/unsubscribeToken.test.ts`

**Token:** `createUnsubscribeToken(tenantId, contactId): string` = `base64url(tenantId.contactId)` + `.` + HMAC-SHA256(`EMAIL_TOKEN_SECRET`, payload) — signed, NOT single-use, NO expiry (a recipient may click any time). `parseUnsubscribeToken(token): {tenantId, contactId} | null` verifies the HMAC with `timingSafeEqual`. Resolves tenant WITHOUT a DB lookup (embedded), so it can be minted per-recipient at send time cheaply.

**Route** `/u/[token]`: parse token → `runWithTenant(tenantId, () => suppress(tenantId, contact.email, "unsubscribe"))` → mark contact `unsubscribed` → return a plain branded "You've been unsubscribed" HTML page (no auth, no session). Idempotent (clicking twice is fine).

**`suppress.ts`:** upsert into `suppressions` (unique email), set matching `contacts.status`. Hard gate reused by the webhook (Task 7).

**Test:** token round-trips; a tampered token → null; `suppress` upserts + flips contact status; unsubscribing an already-unsubscribed contact is a no-op.

---

## Task 7: Mailgun webhook + event ingestion + campaign stats

**Files:**
- Create: `app/src/app/api/mailgun/webhook/route.ts` (signature-verified, public)
- Modify: `app/src/middleware.ts` (`PUBLIC_API_PREFIXES` += `/api/mailgun/webhook`)
- Create: `app/src/lib/marketing/events.ts` (apply an event → campaign_sends + contact + suppression + stats)
- Modify: `app/src/app/campaigns/[id]/page.tsx` (stats view)
- Test: `app/src/lib/marketing/events.test.ts`

**Route:** POST → `verifyMailgunSignature(timestamp, token, signature)` (401 if bad) → `parseMailgunEvent` → resolve tenant from the event's `v:tenantId`/`v:campaignId` user-variable (fallback: `sending_domains` domain→tenant lookup); if unresolved, 200 + ignore (never a default-tenant shortcut). `runWithTenant(tenantId, () => applyEvent(...))`. Always 200 on a verified call (so Mailgun doesn't retry no-ops); 401 only when unverified.

**`applyEvent`:** update the matching `campaign_sends` row by `provider_message_id` (status delivered/opened/clicked/bounced/complained/unsubscribed); **bounce(permanent)/complaint/unsubscribe → `suppress(tenantId, email, reason)`**; recompute the campaign's `stats` JSON (counts). **Reputation:** after applying, if the tenant's rolling complaint rate > 0.1% or hard-bounce > 5% (over its recent sends), auto-set any `sending` campaigns to `paused` and flag it (a `marketing_paused` platform event) — protects the shared account.

**Test:** `applyEvent` transitions (delivered updates status; permanent bounce suppresses + updates; complaint suppresses; stats recompute). Signature verify already tested in Task 3.

---

## Task 8: Admin console — price + credit allocation + suspend (cross-app)

**Files:**
- Modify: `app/src/app/api/platform/settings/route.ts` (+ `emailCreditPricePer1000Cents` field) — or a sibling route
- Modify: `app/src/app/api/platform/tenants/[id]/[action]/route.ts` (+ `grant-credits`, `suspend-marketing`, `resume-marketing` cases)
- Modify: `admin/src/app/(console)/settings/page.tsx` + `settings/actions.ts` (price input)
- Modify: `admin/src/app/(console)/gyms/[id]/page.tsx` + `actions.ts` (credit-grant form + balance display + marketing suspend)
- Modify: `app/src/app/api/platform/tenants/[id]/route.ts` (include email balance + marketing status in the detail payload)
- Test: none new (guarded routes; covered by review) — but add a zod-schema unit test if cheap.

Mirror the platform-settings price flow (blueprint §9 Example B) for the price, and the `compMonths` action shape for `grant-credits` (`z.object({ credits: z.number().int().positive() })` → `grantCredits(id, cents, actor)`). `guardPlatform` on every route; `actor = "admin:"+g.userId`. Admin `gyms/[id]` gains its first numeric input form (mirror `settings/page.tsx`'s `<input type="number">` + form-action idiom). **Cross-app deploy:** main app first (routes), then admin (buttons) — else the admin buttons 404.

---

## Task 9: Nav + module wiring + deps/build verify + docs + final review

**Files:**
- Modify: `app/src/components/layout/Sidebar.tsx` (Marketing section: a `Campaigns` group → Campaigns / Contacts / Sending domains[adminOnly])
- Verify/ços: `next build` standalone (no new runtime deps — Mailgun is `fetch`, so nothing to trace; confirm)
- Modify: `CLAUDE.md` + memory note
- Final whole-branch review (opus)

**Steps:** wire the nav group (blueprint §10); ensure every new page is admin-gated where appropriate; `npm run typecheck` + `npm test` + `npx next build` green; confirm no new node_modules needed (Mailgun via fetch — if anyone added `mailgun.js`, remove it). Env doc: `MAILGUN_API_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_REGION`. **Final review focus:** money path (credits can't go negative / double-charge; transaction integrity), compliance (unsubscribe header+link+suppression present on every send; only subscribed sent), tenant isolation across send + webhook (correct tenant DB; webhook never defaults tenant), no leaked endpoints, never-throw, CreatePay charge stays inert.

**Manual verification (operator, after deploy):** set `MAILGUN_*` env, connect + verify a domain, import a small test list, allocate credits in the admin console, send a test campaign to yourself, confirm delivery + open/click + unsubscribe + the webhook updating stats.
