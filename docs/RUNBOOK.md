# AdonisAgent — Operations Runbook

> **Audience:** the agency team + partners running client accounts.
> **Scope:** onboarding a client end-to-end, day-to-day operations, and troubleshooting.
> This is a living doc — keep it current as flows change.

---

## 0. Platform map (30-second orientation)

- **`app.adonisagent.ie`** — the main app (CRM + CMS + AI agents). Railway service **`clientflow`**.
- **`admin.adonisagent.ie`** — the platform / billing console (provision tenants, grant credits, set prices). Railway service **`clientflow-admin`**.
- **Tenant = one client business.** Each has its own SQLite DB; a central **control DB** routes users, domains, credits, and API keys to the right tenant.
- **Two sending streams, kept separate:** transactional email (invites, resets) on **Resend**; bulk **campaigns** on **Mailgun** (per-tenant verified subdomains).
- **Deploy:** `railway up` from `app/` — see §2.5.

---

## 1. Onboard a new client — the full sequence

Work top to bottom. Steps 1.3–1.5 need the client's DNS access and a card on file for their credits.

### 1.1 Provision the tenant
1. **Admin console** (`admin.adonisagent.ie`) → **Provision**.
2. Enter the business name, slug, and owner email → creates the tenant + its admin login.
3. The owner gets an invite email (from `no-reply@adonisagent.ie`) to set their password.

### 1.2 Build their website
- **Bespoke build:** create the site under `sites/<slug>/` (static HTML/assets), then import:
  ```bash
  node tools/import-site.cjs --slug <slug> --name "<Business Name>"
  ```
  (copies assets → `app/public/sites/<slug>/`, rewrites links, maps title/meta → SEO, publishes.)
- **Or** author pages directly in the CMS + **Studio** visual editor (`/cms/<slug>`).

### 1.3 Connect their email sending domain (Mailgun)
The platform runs **one shared Mailgun account (EU region)**; each tenant verifies its **own subdomain**.

1. Switch to the tenant → **Campaigns → Domains** → connect **`mg.<clientdomain>`**.
   - ⚠️ **Use a subdomain distinct from any existing sender.** If the client already sends via GoHighLevel/another tool (often on `emails.` or `mail.`), pick a *different* label (`mg.`, `mkt.`, `news.`). Different subdomain = independent auth + reputation → **their existing email is unaffected, and both can run at once.**
2. Publish the **3 DNS records** it returns, at the client's DNS host, on the `mg` subdomain:

   | Type | Name (relative to root zone) | Value |
   |------|------------------------------|-------|
   | TXT (SPF) | `mg` | `v=spf1 include:mailgun.org ~all` |
   | TXT (DKIM) | `<selector>._domainkey.mg` | the long `k=rsa; p=…` — **click the value in the app to copy; never retype** |
   | CNAME (tracking) | `email.mg` | `eu.mailgun.org` |

   - The DKIM **selector varies per domain** (e.g. `s1`, `mta`) — use whatever the app shows.
   - No quotes around the SPF value. All three sit on `mg.` so they never touch the client's other records.
3. Hit **Check Verification** → `verified`.
   - **Webhooks + open/click tracking auto-register on connect** — no Mailgun dashboard step needed (handled by `connectDomain` → `configureDomainDelivery`).

### 1.4 Wire lead intake (Zapier / Make → the platform)
Leads post into a per-tenant webhook; the **API key** both authenticates and routes to the tenant.

1. In the tenant → **Settings → API keys → Create key** → copy `cf_live_…` (**shown once**).
2. In the **agency's single** Zapier/Make account, add **one scenario per client**:
   - **Trigger:** the lead source (Facebook Lead Ads, a form, …).
   - **Action:** HTTP POST →
     ```
     URL:    https://app.adonisagent.ie/api/leads/inbound
     Header: x-api-key: cf_live_…        (this client's key)
     Body (JSON):
       { "source": "facebook",
         "sourceLeadId": "<the source's own lead id>",   ← dedup key
         "campaign": "...", "firstName": "...", "lastName": "...",
         "email": "...", "phone": "...", "notes": "..." }
     ```
   - **One agency account handles every tenant** — the *key* decides the destination, so name each scenario clearly ("Inspire — FB leads").
   - **Facebook:** the agency's connected FB account needs access to each client's Page via **Meta Business Manager** partner access.
3. Test: a successful post returns `{"ok":true,"leadId":…,"created":true}` and the lead appears in the tenant's **Leads** (deduped on `source`+`sourceLeadId`).

> **Future:** a native Facebook integration (our own Meta app + `leadgen` webhook) drops in behind this with no disruption — same lead store, same dedup. Keep `source:"facebook"` + FB lead id consistent and the swap is a clean cutover.

### 1.5 Grant credits
Admin console → the tenant's detail page → **Grant credits**:
- **Email credits** (for campaigns) + set the **per-1,000 price** (Settings) — prepaid, at a margin over Mailgun cost.
- **AI credits** (agents + Content Studio) — €25/mo free tranche is built in; top-up beyond that.

### 1.6 Go live on their domain
1. CMS → the site → **Domains** → add the client's public hostname.
2. Verify **DNS-TXT ownership** (the platform requires it before a hostname serves).
3. Set **`CMS_SITE_HOSTS`** on the deploy (`host=slug,…`) and point the client's DNS at Railway.

---

## 2. Day-to-day operations

### 2.1 Grant / adjust credits
Admin console → tenant detail → Grant credits (email or AI). Suspending a tenant's credits is on the same page.

### 2.2 Connect a domain / edit DNS
- Sending domains: §1.3. Public site domains: §1.6.
- **Hosting Ireland** (`clients.hostingireland.ie`): names are **fully-qualified** (`mg.<domain>`); no quotes on TXT values.

### 2.3 Generate / revoke API keys
Tenant → **Settings → API keys**. Keys are `cf_live_…`, scoped (default `leads`), shown once, revocable. Only the sha256 hash is stored.

### 2.4 Send a campaign (pre-flight checklist)
- Sending domain **verified** ✅ · tenant has **email credits** ✅ · From address is `@<verified sending domain>` (enforced).
- Import contacts (Campaigns → Contacts) · build + AI-draft · send · watch stats (delivered → opened → clicked) update via the webhook · confirm the unsubscribe link works.

### 2.5 Ship a change (deploy)
```bash
# from app/
npm run typecheck && npm test && npm run build:prod   # the gate (CI runs these too)
railway up --detach                                    # deploys the clientflow service
```
- **Land changes on `main` first**, then deploy.
- **Verify:** `curl -s -o /dev/null -w '%{http_code}' https://app.adonisagent.ie/api/health` → `200`; and `railway status` until the **deployment ID changes** and status is plain `● Online` (the status text alone is unreliable mid-build).
- The **admin** app is a separate Railway service — deploy it from `admin/`.

---

## 3. Troubleshooting — symptom → cause → fix

| Symptom | Likely cause | Fix |
|--------|--------------|-----|
| "Your connection is not private" / cert error on a client URL | You're on a **retired/wrong hostname** whose DNS still points at Railway but no longer serves that cert | Use the current host (`app.adonisagent.ie`); delete the dangling `CNAME` at the DNS host |
| **"Invalid token"** when saving a record in Hosting Ireland DNS Manager | Stale page **security token** (not your record) | **Hard-refresh** the DNS Manager page, re-add the record |
| Mailgun **webhook 401** / campaign stats never update | `MAILGUN_WEBHOOK_SIGNING_KEY` missing or wrong | Set the correct key on the `clientflow` service, redeploy |
| Email **won't send** | Domain not `verified`, **no email credits**, or wrong `MAILGUN_REGION` | Verify domain (§1.3); grant credits (§1.5); region must be `eu` |
| Domain **won't verify** | DNS propagation (TTL), or a **missing/typo'd record** (often the SPF that hit "Invalid token") | Re-check all three records resolve (`dig +short <name> TXT/CNAME`); wait out TTL |
| Leads webhook **401** | Wrong/revoked API key, or key not scoped for `leads` | Re-mint the key (§2.3); ensure the `x-api-key` header is set |
| AI/agent request **blocked** | Tenant over its AI credit balance / suspended | Grant AI credits (§2.1) |

---

## 4. Reference

**Services & URLs**
- App: `https://app.adonisagent.ie` (Railway `clientflow`) · Health: `/api/health`
- Admin: `https://admin.adonisagent.ie` (Railway `clientflow-admin`)
- Inbound leads: `POST /api/leads/inbound` (public, API-key auth)
- Mailgun webhook: `POST /api/mailgun/webhook` (public, HMAC-verified)

**Key env vars** (`app` service — see `app/src/lib/env.ts`)
- `ANTHROPIC_API_KEY` (required — AI everywhere)
- `RESEND_API_KEY`, `PLATFORM_EMAIL_FROM` (default `no-reply@adonisagent.ie`), `APP_URL`
- `MAILGUN_API_KEY`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `MAILGUN_REGION=eu`
- `CMS_SITE_HOSTS` (public host→tenant routing), `CRON_SECRET`, `OPENROUTER_API_KEY`
- `BACKUP_S3_*` / `BACKUP_R2_*` (off-volume backups)

**Handy commands**
```bash
# Mailgun domain state / webhooks (EU)
curl -s --user "api:$MAILGUN_API_KEY" https://api.eu.mailgun.net/v3/domains/<domain> | grep -o '"state":"[^"]*"'
# Test a tenant's lead intake
curl -X POST https://app.adonisagent.ie/api/leads/inbound -H "x-api-key: cf_live_…" \
  -H "Content-Type: application/json" -d '{"source":"test","email":"you@example.com"}'
```
