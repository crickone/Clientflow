# Platform Console v2 — scope

Date: 2026-09-18. Status: scope for approval, not yet planned into tasks.

## Goal

One console (admin.adonisagent.ie) where platform staff can see and change every aspect of every tenant, safely, with a record of who did what. Today's console covers money well and almost nothing else. This document lists the whole surface, groups it into a tenant hub with nine tabs plus a set of fleet-wide pages, and proposes the build order.

## Where we are

Built July 2026, live. A separate Next app with no database of its own; every read and write goes through `/api/platform/*` in the main app behind a service key plus a platform-admin session.

What it can do per tenant today:

- Billing: status, exempt/unexempt, charge now, mark paid, waive, comp; invoices; billing events.
- Venue type (gym or clinic).
- Email marketing: credit grants, included sends, suspend/resume.
- AI credits: grants, free tranche, auto top-up, suspend/resume.
- Voice: credits, cap, suspend/resume, month usage.
- Add-ons (trial/active/cancelled).
- Danger zone: suspend, reactivate, offboard.
- Open as tenant (audited as an event).

Platform-wide: provision a tenant (name, slug, venue type, first admin), analytics dashboard, prices and allowances (monthly price, VAT, email price and included sends, AI margin, voice price, included and trial minutes).

What it cannot do today, and what "every aspect" needs:

| Area | State today | Where the data already lives |
| --- | --- | --- |
| People (users, roles, invites, resets, sessions) | Nothing. Only the tenant's own admin can, from inside the app. | control: users, memberships, user_invites, user_password_resets, auth_sessions |
| Integrations (Gmail, IMAP, Facebook pages, Meta posting, Mailgun domains, API keys, site domains) | Nothing. | control: gmail_connections, imap_connections, facebook_pages, api_keys, site_domains; tenant settings: meta_connection, sending domain |
| Features and setup (modules on/off, scheduling mode, design system, brand, setup progress) | Venue type only. | tenant settings keys: venue_type, scheduling_mode, design_system, brand_*, setup_* |
| Data (clients, leads, sites, content, storage) | Client and staff counts. | tenant DB tables; volume: uploads 780M, image-library 475M, renders 117M (fleet total) |
| Health (DB integrity, migrations, queues, tickers, errors) | Nothing. | tenant DB: schema_migrations, automation_queue, scheduled_posts, carousel_sets; control: cron_state |
| Support (notes, merged timeline, impersonation reason, contact admins) | Events list; open-as with no reason recorded. | control: billing_events; tenant DB: activity_log |
| Platform audit and roles | Single `is_platform_admin` flag; no audit table for console actions beyond billing events. | control: users |

## The tenant hub

Replace the single long gym page with a hub: a header (name, slug, venue, status chips, open-as) and nine tabs. Each tab below lists what it shows, what you can do, and the source. "Control" means the control-plane database; "tenant" means that tenant's own database; "computed" means calculated on demand or by a nightly job.

### 1. Overview

Shows: status (active, suspended, archived, billing state), venue and scheduling mode, plan and MRR, credits at a glance (email, AI, voice), user count, client and lead counts, storage used, last login, last activity, open alerts from Health. Do: open as tenant (with a reason), pin a note, jump to any tab. Source: control + tenant + computed.

### 2. People

Shows: every user with access (name, email, role, active, last login, must-change-password), pending invites, open password resets, active sessions. Do: invite, change role, deactivate/reactivate, resend invite, force password reset, revoke sessions, transfer ownership, add a platform staff member to the tenant temporarily. Source: control (users, memberships, user_invites, user_password_resets, auth_sessions).

### 3. Money

Shows: what exists today (billing, invoices, add-ons, credits with ledgers), plus per-tenant price override and discount, next renewal, payment method (last four and expiry), lifetime paid. Do: everything today can, plus set a price override, issue a manual invoice or credit note, refund an invoice, export a statement. Source: control (tenant_billing, billing_invoices, *_credits, *_ledger).

### 4. Usage and limits

Shows: this month and last month for AI spend by agent, email sends, voice minutes, research calls, storage by kind (uploads, image library, renders, DB), API calls by key. Caps next to each. Do: set AI cap, research cap, voice cap, email included, storage quota (visibility first, enforcement later), reset a month for a refund. Source: control (ai_usage, email_usage, voice_usage, research_usage, tenant_*_cap) + computed storage.

### 5. Integrations and domains

Shows: one row per connection with status (connected, expired, revoked), who connected it, last used: Gmail, IMAP, Facebook pages (lead ads), Meta posting connection (once approved), Mailgun sending domain with DNS state, site domains with verification, API keys with prefix and last used, WhatsApp routing. Secrets are never returned to the console; presence and last-four only. Do: revoke, re-verify DNS, rotate or revoke an API key, resend the connect link to the tenant's admin, test a connection. Source: control (gmail_connections, imap_connections, facebook_pages, api_keys, site_domains) + tenant settings (meta_connection, sending domain).

### 6. Features and setup

Shows: module flags (timetable, memberships, packages, nutrition, workout, campaigns, voice, research, CMS, content studio, automations, forms), venue type, scheduling mode, design system present or not, brand assets present, setup checklist progress. Do: turn modules on or off per tenant, set venue and scheduling mode, reset setup, copy a settings bundle from another tenant, set the defaults new tenants start with. Source: new tenant settings key `features` read by the tenant app's nav and route guards; existing keys for the rest.

### 7. Data

Shows: counts and recent rows for clients, leads, appointments or classes, sites and pages, blog posts, designs, campaigns, email campaigns, forms; a read-only lookup of one person by name, email or phone across clients and leads. Do: export the tenant (DB plus assets as a zip), download a backup, restore a backup to the same tenant, export one person's data, delete one person (GDPR), archive then hard-delete the tenant after 30 days. Source: tenant DB + volume.

### 8. Health

Shows: DB file size and WAL size, integrity check result, migrations applied vs expected, last backup, queue depths (automation_queue due and failed, scheduled_posts due and waiting on connection, designs stuck in writing), dispatch ticker and daily scheduler last run, webhook events in the last day (Mailgun, Facebook), recent errors from logs for this tenant. Do: run integrity check, rerun migrations, retry failed queue items, clear a stuck generation, re-run the daily job. Source: tenant DB + control (cron_state) + a new lightweight error log.

### 9. Timeline and notes

Shows: one merged timeline of billing events, console actions (from the new audit table), tenant activity_log highlights, impersonation sessions with reason; free-text notes with author and date; tags and account owner. Do: add a note, tag, assign an owner, email the tenant's admins from a template, set a banner the tenant sees in-app (maintenance, overdue, announcement). Source: control (billing_events, platform_audit, tenant_notes) + tenant activity_log.

## Fleet-wide pages

- Tenants: search across name, slug, admin email, domain; filters (status, venue, plan, module, health alerts); saved views; bulk actions (suspend, message admins, set a flag).
- Health: every tenant's alerts in one list; ticker heartbeats; storage totals; queue totals; recent errors fleet-wide.
- Audit log: every console action with actor, tenant, before and after, reason; filter and export.
- Platform staff: who has console access, with roles: owner (everything), support (read all, people and integrations and notes, open-as), finance (money), read-only.
- Settings: what exists today, plus defaults for new tenants (features, allowances) and kill switches (pause all AI, all email sending, all posting) with a reason and an audit entry.
- Announcements: a banner or in-app message to all tenants or a filtered set, scheduled, with a record of who saw it.

## Architecture

- Keep the pattern: the console has no database; every capability is a `/api/platform/*` route in the main app, guarded by service key plus session. Add role checks to the guard.
- New control tables: `platform_audit` (actor, tenant, action, before, after, reason, ip), `tenant_notes`, `tenant_tags`, `platform_roles` (or a role column on users), `error_log` (tenant, source, message, first and last seen, count).
- New tenant settings key `features` (JSON of module flags); the tenant app's sidebar and route guards read it; unset means all on, so nothing changes for existing tenants.
- Computed stats (storage, counts, health) cached by a nightly job into a `tenant_stats` table with on-demand refresh, so the fleet pages do not scan every database per load.
- Secrets are never sent to the console: routes return presence, owner and last-four only.
- Destructive actions: typed confirmation in the console, a reason field, an audit row, and reversibility where possible (archive before delete with a 30-day window; backup before restore).
- Impersonation: extend the existing open-as flow with a reason, a visible banner inside the tenant app while a platform session is active, and auto-expiry.

## Build order

| Slice | Delivers | Effort |
| --- | --- | --- |
| 1. Foundation | Platform roles and guard, `platform_audit` on every existing action, the hub shell with tabs and search, impersonation reason and banner | 1 session |
| 2. People | Users, memberships, invites, resets, sessions, ownership transfer, platform staff page | 1 session |
| 3. Integrations and domains | Status board, revoke and reconnect, DNS re-verify, API keys, Meta posting connection status | 1 session |
| 4. Features and setup | Module flags with tenant-app enforcement, defaults for new tenants, settings bundle copy, setup progress | 1 session |
| 5. Health | Per-tenant health, queue views and retries, ticker heartbeats, error log, fleet health page, nightly stats job | 1 to 2 sessions |
| 6. Data and support | Data counts and person lookup, tenant export, backup and restore, GDPR export and delete, notes, tags, merged timeline, banners, email admins | 2 sessions |
| 7. Money extras | Price overrides, manual invoices and credit notes, refunds, statements | 1 session |
| 8. Fleet | Tenants list with filters and bulk actions, audit log page, kill switches, announcements | 1 session |

Roughly nine to ten sessions in total. Slices 1 and 2 first; after that the order can follow whatever hurts most in day-to-day support.

## Guardrails

- Every write from the console is audited with the actor and a reason where it changes money, access or data.
- No route ever returns a token, password hash or key body.
- Hard delete is never a single click: archive, wait, then delete, with a backup taken first.
- Restore and re-run migrations run on a copy first and report before touching the live file.
- Platform staff roles are enforced in the API, not only hidden in the UI.

## Decisions needed

1. Platform roles: are four roles (owner, support, finance, read-only) the right cut, or is owner plus support enough for now?
2. Deleting a tenant: archive-only with manual purge, or a 30-day automatic hard delete?
3. Module flags: per module, or bundle into plan tiers the flags follow?
4. Storage quotas: visibility only, or enforce at a limit?
5. Order after slices 1 and 2: health first, or integrations first?
