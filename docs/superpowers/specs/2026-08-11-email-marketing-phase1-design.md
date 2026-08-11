# Email Marketing (GHL-style) — Phase 1 Design

**Status:** Draft for review · 2026-08-11
**Goal:** Give each tenant a GoHighLevel-style bulk email capability inside ClientFlow — import contacts, build a campaign, and send it from the business's own verified domain — with every send metered against a prepaid **credit balance** the platform sells at a margin. ClientFlow is the cockpit; **Mailgun** is the engine.

## Decisions locked (from design discussion)

- **Sending engine:** platform-owned **Mailgun** (one platform account; `MAILGUN_API_KEY` env, like `RESEND_API_KEY`). Behind a provider-neutral `CampaignSender` adapter so Mailgun ↔ SES/Resend is swappable and **subaccounts can be turned on later without a rewrite**.
- **No subaccounts in Phase 1.** Single account + per-tenant verified domains. Reputation isolation via subaccounts is deferred until after the partner-business rollout proves it out. Adapter is built subaccount-ready.
- **Billing = prepaid credits at 5× margin.** Each tenant holds a credit balance; every send decrements it; sending pauses at zero. Platform sets the per-email price (admin-adjustable, default ~5× Mailgun cost). **Auto-top-up:** tenant configures "recharge €X when balance < €Y."
- **Real money collection depends on CreatePay, which is still in dev.** So Phase 1 builds the full credit ledger + metering + gating + auto-top-up *config and logic*, but the actual charge is a **stubbed hook**: until CreatePay is live, credits are allocated manually (platform admin comps/top-ups a balance). The charge call slots in when CreatePay ships — no rework.
- **Transactional stays on Resend.** Invites/resets/1-to-1 keep using the existing email layer (gmail/imap/resend). Marketing is a separate stream on Mailgun — a bad marketing complaint must never hurt login/invite deliverability.
- **Compliance is non-negotiable:** one-click unsubscribe (List-Unsubscribe header + footer link), per-tenant suppression list, sender identity in the footer, bounces/complaints auto-suppress. EU/Ireland GDPR + ePrivacy.

## Architecture

```
Tenant app (cockpit)                 Platform                         Mailgun (engine)
──────────────────                   ────────                         ────────────────
Contacts + import          ┌─▶ email_credits (balance,        ┌─▶ send batch (per-tenant
Campaign builder + send ───┤   auto-topup) + ledger  ◀────────┤   verified domain)
Suppression / unsubscribe  │   (control plane)                │   domain register/verify
Campaign stats             │                                  │   events webhook ─┐
                           └── CampaignSender adapter ─────────┘                   │
Public: /u/<token> (unsubscribe)   /api/mailgun/webhook (signed) ◀─────────────────┘
```

- **`CampaignSender` interface** (`src/lib/marketing/sender/`): `registerDomain(domain)`, `getDomainStatus(domain)`, `sendBatch(fromDomain, from, messages[])`, `verifyWebhookSignature(req)`, `parseEvent(payload)`. Mailgun implementation now; interface keeps the engine swappable.
- **Meter-then-send:** every send goes through the credit ledger (reserve → send → reconcile against webhook delivery). No path sends without decrementing credits.

## Data model

**Tenant DB (per business):**
- `contacts` — `id, email (unique per tenant), name, phone?, tags (JSON text[]), status ('subscribed'|'unsubscribed'|'bounced'|'complained'|'cleaned'), source, subscribed_at, unsubscribed_at, created_at, updated_at`. Import dedupes by lower(email).
- `email_campaigns` — `id, name, subject, preheader?, from_name, from_email, body_html, audience (JSON: {tag?|'all_subscribed'}), status ('draft'|'sending'|'sent'|'paused'|'failed'), scheduled_at?, sent_at?, stats (JSON counts), created_by, created_at`.
- `campaign_sends` — per-recipient: `id, campaign_id, contact_id, email, mailgun_message_id, status ('queued'|'delivered'|'bounced'|'complained'|'opened'|'clicked'|'unsubscribed'|'failed'), error?, updated_at`. Powers per-campaign stats + reconciliation.
- `suppressions` — `email (unique per tenant), reason ('unsubscribe'|'bounce'|'complaint'|'manual'), created_at`. Enforced at send; hard gate.
- `sending_domains` — `domain, mailgun_domain_id, status ('unverified'|'verified'|'failed'), dns_records (JSON), verified_at`. The tenant's own from-domain, registered in the platform Mailgun account.

**Control plane (platform):**
- `email_credits` — `tenant_id (unique), balance_cents, auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents, updated_at`.
- `email_credit_ledger` — `id, tenant_id, delta_cents, reason ('topup'|'send'|'adjustment'|'refund'|'auto_topup'), campaign_id?, balance_after_cents, note, created_at`.
- Platform settings: `email_price_per_1000_cents` (admin-adjustable; default = 5× Mailgun cost), `MAILGUN_API_KEY` + `MAILGUN_REGION` env.

## Key flows

1. **Import contacts** — upload CSV → map columns → validate + dedupe by email → insert as `subscribed` (skip anything already in `suppressions`) → import summary (added / skipped / invalid).
2. **Connect sending domain** — admin enters domain → adapter registers it in Mailgun (platform key) → ClientFlow shows the DNS records (DKIM/SPF/tracking CNAME) → poll `getDomainStatus` until verified. Reuses the SPF/DKIM discipline the operator already knows.
3. **Create + send campaign** — compose (subject + from on the verified domain + body via a simple composer that reuses the branded email shell + Content Studio AI drafting) → pick audience (a tag or "all subscribed") → preview → **pre-send checks:** domain verified, unsubscribe link present, and `balance ≥ recipients × price`. On send: reserve credits, batch-send via Mailgun (throttled, skipping `suppressions`/non-`subscribed`), write `campaign_sends` rows, set campaign `sending`→`sent`.
4. **Unsubscribe** — every email carries a `List-Unsubscribe` header + footer link → public `/u/<token>` (token = signed tenant+contact+campaign) → mark contact `unsubscribed` + add to `suppressions` → confirmation page. No auth.
5. **Mailgun webhook** — `/api/mailgun/webhook` (signature-verified, public) → update `campaign_sends` + contact status; **bounce/complaint → auto-suppress**; unsubscribe events too. Roll counts into campaign `stats`.
6. **Credits + auto-top-up** — send decrements `email_credits.balance` and writes a `ledger` row. If `balance < threshold` and auto-top-up on → **charge hook** (stubbed to CreatePay; until live, logs "would charge €X" and, if the platform admin has pre-authorised, allocates the credits). Manual top-up available in the admin console now.

## Reputation safeguards (shared account, no subaccounts yet)

Because all tenants share one Mailgun account until subaccounts land, one bad sender can hurt the pool. Phase 1 includes:
- Per-tenant `suppressions`, enforced at send; bounces/complaints auto-suppress.
- **Complaint-rate + bounce-rate monitoring** per tenant; if a tenant exceeds a threshold (e.g. complaint rate > 0.1% or hard-bounce > 5% over a window), auto-**pause** that tenant's marketing sending and flag it in the admin console.
- Send throttling (batch + rate limit) so no single blast spikes the shared IP.
- Admin can suspend a tenant's marketing sending from the console.

## Compliance (EU / Ireland)

- One-click unsubscribe: `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058) headers **and** a visible footer link.
- Footer carries the business's identity (name + physical address from the business profile).
- Only `subscribed` contacts are emailed; `suppressions` is a hard gate.
- Unsubscribe/bounce/complaint are irreversible suppressions (re-subscribe is a deliberate manual action).

## Phase 1 scope (what "done" means)

A partner business can: import their leads → connect + verify their domain → compose a campaign → send it to a segment, from their own domain, metered against a credit balance, fully unsubscribe-compliant, with delivered/bounce/complaint/unsubscribe (and open/click) tracked back into per-campaign stats — and the platform admin can set the price + allocate credits.

## Out of scope (Phase 2+)

- **Mailgun subaccounts** (per-tenant reputation isolation) — the first post-rollout upgrade.
- Real CreatePay charging for top-ups (hook built now, wired when CreatePay ships).
- Full segment builder (complex multi-condition filters) — Phase 1 is tags + "all subscribed".
- Scheduling / send-time optimisation; drag-and-drop email builder + template library.
- Drip **automations / workflows** (tie into the existing Automations module).
- A/B testing; deliverability/reputation dashboards beyond basic counts.

## Prerequisites (operator actions)

- Create a **Mailgun** account (Foundation, $35/mo/50k), set `MAILGUN_API_KEY` + `MAILGUN_REGION` on the platform. Build proceeds without it; live *sending* needs it.
- Each partner business verifies its sending domain via the in-app flow (needs DNS access).
- **CreatePay** live to auto-charge top-ups (deferred; manual credit allocation until then).

## Open defaults (adjustable on review)

- **Price:** default `email_price_per_1000_cents` = 5× Mailgun's ~$0.70/1000 ≈ **€0.35–0.40/1000** cost → charge ~**€2/1000** (round, ~5×). Admin-adjustable.
- **Composer:** simple subject + branded HTML body (reuse the email shell + Content Studio AI drafting), not a drag-drop builder, in Phase 1.
- **Open/click tracking:** on by default (Mailgun tracks it; feeds stats). Flagged for the GDPR-conscious; can be a per-campaign toggle.
