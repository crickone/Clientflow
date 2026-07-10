# WhatsApp Messaging via a QR-Linked Bridge Provider

**Date:** 2026-05-23
**Status:** Design approved — spec under review
**Part of:** the ClientFlow roadmap (a messaging integration). Builds on the
existing leads message-thread + AI draft, and the business-profile-aware AI.

## Context & approach

Businesses want to message their leads and clients over WhatsApp from inside
ClientFlow — the way the user does today in GoHighLevel via WAGHL.

WAGHL is a **QR-linked WhatsApp Web bridge**: you scan a QR with your WhatsApp
(Business) app and it relays messages through the conversation/SMS channel. It
sidesteps Meta's official Cloud API entirely — **no message templates, no
24-hour window, no opt-in gating** — at the cost of being **unofficial / against
WhatsApp's ToS** (ban risk on the number) and needing an always-on session.

**Decision:** integrate a **third-party unofficial-WhatsApp API provider** that
runs the QR-linked session for us and exposes a REST API + webhooks. Default
provider: **Whapi.cloud** (clean JSON API, QR/pairing link, inbound + status
webhooks, flat monthly pricing); Maytapi is a drop-in alternative. We build a
**provider-agnostic adapter** so the vendor is swappable.

Half the surface already exists: the leads module has a message thread (draft,
edit, "Send", channel badges, reply composer) and `lead_messages.channel`
already includes `whatsapp` — but "Send" only *logs* today. This adds the real
transport + inbound, and extends messaging to clients.

Approved decisions:
- **Bridge = third-party provider** behind a `WhatsAppBridge` adapter (default Whapi.cloud).
- **Audience = leads AND clients** (clients get a new conversation thread).
- **Two-way** (send + receive via webhook).
- **Single connected number now** (Renova's); per-business QR connection comes with tenancy.
- **Data model = parallel `client_messages` table** (additive; no migration of `lead_messages`).

## Architecture

### 1. Bridge adapter — `src/lib/whatsapp/`

`types.ts` — the `WhatsAppBridge` interface:
- `sendText(toPhone: string, text: string): Promise<{ providerMessageId: string }>`
- `connectionStatus(): Promise<{ connected: boolean; phone: string | null }>`
- `getQrCode(): Promise<{ qr: string | null; connected: boolean }>` — for linking
- `parseInboundWebhook(payload): { fromPhone, text, providerMessageId, timestamp } | null`
- `parseStatusWebhook(payload): { providerMessageId, status } | null`
- `verifyWebhook(req): boolean` — shared-secret/signature check

`whapi.ts` — `WhapiBridge` implementing the interface against Whapi.cloud REST
(base URL + token from config). Phone numbers normalised to E.164 (no `+`,
digits only) per the provider's expectation.

`index.ts` — `getWhatsAppBridge(): WhatsAppBridge` factory reading the configured
provider + credentials (see §2). Throws a clear error if not configured.

`server-only`. No vendor types leak past the adapter — callers use the interface.

### 2. Connection config + Settings UI

- Credentials stored as settings keys (single instance now; per-tenant later):
  `whatsapp_provider` (default `"whapi"`), `whatsapp_token`, `whatsapp_channel`,
  `whatsapp_webhook_secret` (generated). Helpers in a small
  `src/lib/whatsapp/config.ts` (`getWhatsAppConfig()` / `setWhatsAppConfig()`).
- `src/app/settings/integrations/whatsapp/page.tsx` (admin-only): shows
  **connection status** (linked number, connected/disconnected), a **QR code**
  to link (from `getQrCode()`, polled until connected), the token/channel
  fields, and the inbound **webhook URL** to paste into the provider dashboard.
- Settings index gets an **Integrations → WhatsApp** entry.

### 3. Data model (additive — PRAGMA-guarded `ADD COLUMN` / `CREATE TABLE IF NOT EXISTS` in `db/index.ts`, plus Drizzle defs)

- `lead_messages`: add `provider_message_id TEXT` and
  `status TEXT` (`queued|sent|delivered|read|failed`, nullable — null for
  legacy/manual log entries).
- New **`client_messages`** table mirroring `lead_messages`:
  `id, client_id (FK→clients, cascade), direction (outbound|inbound|note),
  channel, content, ai_generated, provider_message_id, status, sent_at,
  created_at`. Drizzle table + `ClientMessage`/`NewClientMessage` types.
- Contact resolution: match an inbound `fromPhone` to a lead or client by phone
  (normalise both sides to compare). Prefer an existing client; else a lead;
  else create/park as an unmatched inbound (store on a lead with
  `source="whatsapp"` so nothing is lost).

### 4. Sending

- `src/lib/whatsapp/send.ts` — `sendWhatsApp({ subjectType: "lead"|"client",
  subjectId, text, aiGenerated? })`:
  1. Resolve the recipient phone (lead.phone / client.phone); error if missing.
  2. `getWhatsAppBridge().sendText(phone, text)`.
  3. Store the outbound message (`status: "sent"`, `providerMessageId`,
     `sentAt: now`) in the right table; `logActivity`.
- Wire-in:
  - Leads: the thread's existing send path calls `sendWhatsApp` when channel =
    whatsapp (instead of only logging). Other channels keep logging as today.
  - Clients: a new conversation thread on the client profile reusing the shared
    thread component, with a WhatsApp send.
- AI draft: the existing `draftFollowup` (already business-profile-aware) feeds
  the composer; sending is unchanged from the user's point of view.

### 5. Inbound + delivery status — `POST /api/whatsapp/webhook`

- **Public** route (added to middleware `PUBLIC_API_PREFIXES`), but
  `verifyWebhook()` checks the shared secret / signature before doing anything.
- On an inbound message: parse → resolve lead/client by phone → store inbound
  `client_messages`/`lead_messages` row → bump lead status to `replied` →
  `logActivity`.
- On a status callback: update the matching row's `status` by
  `provider_message_id`.
- **Dependency:** receiving requires the app reachable at a public HTTPS URL —
  so inbound is gated on real hosting (deployment phase). **Outbound sending
  works now** from the running instance.

### 6. Shared conversation thread

Extract the leads message-thread UI into a reusable
`src/components/messaging/ConversationThread.tsx` (props: messages, a
`channel`, an `onSend`, an optional `onAIDraft`). Leads and the client profile
both render it. This avoids duplicating the thread and keeps WhatsApp behaviour
consistent. (Targeted refactor of `LeadDetail`'s thread into the shared
component — in scope because both audiences need it.)

## Out of scope
- Per-tenant credentials / per-business QR connection (tenancy phase — the
  adapter + config just become per-tenant).
- SMS fallback for non-WhatsApp numbers; broadcast/bulk campaigns; group chats;
  media attachments (text first); opt-out keyword automation (note for
  compliance later).
- Official Meta Cloud API path.

## Risks & honest caveats
- **Unofficial / ToS:** linking via WhatsApp Web automation violates WhatsApp's
  Terms; the number can be banned. Legitimate use (a business messaging its own
  clients), but the risk is real and the user's call. Surface this in the
  Settings UI copy.
- **Reliability:** the linked session can drop (phone offline, WhatsApp changes)
  — the Settings status + re-link QR handles recovery; sends should fail
  gracefully with a clear error + retain the draft.
- **Provider fee** and rate limits apply.

## Verification
- Adapter unit-level: `parseInboundWebhook`/`parseStatusWebhook` map sample
  provider payloads correctly; phone normalisation round-trips.
- With test credentials (Whapi sandbox/trial): link via QR, send a text to a
  test number, confirm it stores `sent` + `providerMessageId`; simulate an
  inbound webhook → confirm it threads against the right lead/client and flips
  status to `replied`; simulate a status webhook → row status updates.
- Clinic view unchanged for non-WhatsApp flows; `tsc`/build clean.
- Confirm the webhook rejects unsigned/secret-less calls.

## Notes
- Repo is not under git, so this spec is saved but not committed.
- Sources: WAGHL (waghl.com), Whapi.cloud, Maytapi.com.
