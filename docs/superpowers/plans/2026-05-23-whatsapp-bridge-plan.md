# Implementation Plan — WhatsApp via QR-Linked Bridge Provider

**Spec:** `docs/superpowers/specs/2026-05-23-whatsapp-bridge-design.md`
**Approach:** provider-agnostic `WhatsAppBridge` adapter (default Whapi.cloud);
send now + inbound webhook (inbound gated on public hosting); leads + clients
through a shared conversation thread; single connected number (per-tenant later).

**Sequencing principle:** build inert pieces first (adapter, config, schema),
then the connection UI, then sending, then the shared thread + client messaging,
then inbound. After every phase: `tsc` clean; nothing breaks for non-WhatsApp
flows. Live send/receive checks need provider test credentials (Phase 7).

---

## Phase 0 — Adapter interface + Whapi implementation

**Objective:** the swappable bridge, with no UI wired yet.

**Files (`src/lib/whatsapp/`, all `server-only`):**
- `types.ts` — `WhatsAppBridge` interface: `sendText`, `connectionStatus`,
  `getQrCode`, `parseInboundWebhook`, `parseStatusWebhook`, `verifyWebhook`
  (signatures per spec §1). Plus shared types (`InboundMessage`, `MessageStatus`).
- `phone.ts` — `normalizePhone(raw): string` → E.164 digits-only (strip `+`,
  spaces, leading `00`); used for both sending and inbound matching.
- `whapi.ts` — `WhapiBridge` implementing the interface against Whapi REST
  (base URL + token injected). Map Whapi payload shapes in the parse* methods.
- `config.ts` — `getWhatsAppConfig()`/`setWhatsAppConfig()` over settings keys
  (`whatsapp_provider`, `whatsapp_token`, `whatsapp_channel`,
  `whatsapp_webhook_secret`); `isWhatsAppConfigured()`.
- `index.ts` — `getWhatsAppBridge()` factory (reads config; throws a clear error
  if unconfigured).

**Verify:** unit-ish — feed sample Whapi inbound/status JSON to the parse
methods, assert mapped shape; `normalizePhone` round-trips a few formats. `tsc`.

---

## Phase 1 — Schema (additive)

**Objective:** storage for provider ids/status + client conversations.

**Files:**
- `src/lib/db/schema.ts`: add `providerMessageId`, `status` to `leadMessages`;
  add a `clientMessages` table (clientId FK→clients cascade, direction, channel,
  content, aiGenerated, providerMessageId, status, sentAt, createdAt) +
  `ClientMessage`/`NewClientMessage` types.
- `src/lib/db/index.ts`: `CREATE TABLE IF NOT EXISTS client_messages …` + index
  on `client_id`; PRAGMA-guarded `ALTER TABLE lead_messages ADD COLUMN
  provider_message_id` / `status`.

**Verify:** boot; `PRAGMA table_info` shows new columns + `client_messages`;
existing lead/data intact; `tsc`.

---

## Phase 2 — Connection config + Settings UI

**Objective:** link a number via QR; see status; get the webhook URL.

**Files:**
- `src/app/settings/integrations/whatsapp/page.tsx` (admin) — reads config +
  `connectionStatus()`/`getQrCode()`; renders status, QR (client component that
  polls until connected), token/channel inputs, the inbound webhook URL +
  secret, and the **ToS/ban-risk notice**.
- `src/components/settings/WhatsAppConnectForm.tsx` (client) — saves config (a
  server action `updateWhatsAppConfig`), polls a `connectionStatus`/`getQrCode`
  endpoint, shows live link state.
- `src/app/settings/integrations/whatsapp/actions.ts` — `updateWhatsAppConfig`
  (requireAdmin → setWhatsAppConfig → revalidate); generates a webhook secret if
  missing.
- `src/app/api/whatsapp/qr/route.ts` + `…/status/route.ts` (admin-gated) — back
  the polling. (Or one route returning both.)
- Settings index: add an **Integrations → WhatsApp** entry.

**Verify:** page renders; saving config persists; with test creds the QR/status
endpoints return sensibly (full link verified in Phase 7). `tsc`.

---

## Phase 3 — Outbound send service

**Objective:** actually send a WhatsApp text and record it.

**Files:**
- `src/lib/whatsapp/send.ts` — `sendWhatsApp({ subjectType, subjectId, text,
  aiGenerated? })`: resolve phone (lead/client), `bridge.sendText`, store
  outbound row (`status:"sent"`, providerMessageId, sentAt) in the right table,
  `logActivity`. Throw a clear error if not configured / no phone / provider
  fails (caller keeps the draft).
- Extend `lib/leads.addMessage` usage / add a `lib/clientMessages.ts` with
  `addClientMessage`/`getClientMessages` (mirror leads helpers).

**Verify:** unit path with a mocked bridge — resolves phone, writes the row,
handles missing-phone/error. `tsc`.

---

## Phase 4 — Shared conversation thread + wire leads

**Objective:** one thread component; leads send real WhatsApp.

**Files:**
- `src/components/messaging/ConversationThread.tsx` — extracted from
  `LeadDetail`'s thread (props: `messages`, `channels`, `onSend(channel,text)`,
  `onAIDraft?`, status badges). Pure presentational + callbacks.
- `src/components/leads/LeadDetail.tsx` — use `ConversationThread`; the send
  handler calls `sendWhatsApp({subjectType:"lead"})` when channel = whatsapp,
  else logs as today. Keep AI-draft wiring.

**Verify:** leads thread looks/behaves as before for non-WhatsApp; WhatsApp send
calls the service; `tsc`. (Clinic-mode visual unchanged.)

---

## Phase 5 — Client conversation thread

**Objective:** message clients/members too.

**Files:**
- `src/app/clients/[id]/page.tsx` — add a **Messages** tab (or section) rendering
  `ConversationThread` with the client's `client_messages` + a WhatsApp send via
  `sendWhatsApp({subjectType:"client"})`.
- `src/app/api/clients/[id]/messages/route.ts` or a server action for send +
  list (mirror the leads draft/send pattern).
- Optional: reuse the AI drafter for clients (nice-to-have; can stub the draft
  button to leads-style if quick).

**Verify:** client profile shows the thread; sending stores a `client_messages`
row + calls the bridge; `tsc`.

---

## Phase 6 — Inbound + delivery-status webhook

**Objective:** receive replies + status (works once publicly hosted).

**Files:**
- `src/app/api/whatsapp/webhook/route.ts` (POST) — `verifyWebhook()` first
  (reject unsigned). Inbound → `parseInboundWebhook` → resolve lead/client by
  normalised phone (client > lead > park as a `source:"whatsapp"` lead) → store
  inbound row → bump lead status `replied` → `logActivity`. Status callback →
  `parseStatusWebhook` → update row by `providerMessageId`.
- `src/middleware.ts` — add `/api/whatsapp/webhook` to `PUBLIC_API_PREFIXES`
  (secret-verified inside the route).

**Verify:** POST a sample inbound payload (with the secret) → threads against the
right contact + flips status; unsigned/secret-less POST is rejected (401);
status payload updates a row. `tsc`. (Real end-to-end inbound needs public
hosting — note in report.)

---

## Phase 7 — Verification pass

- Adapter parse/normalise checks (Phase 0) green.
- With Whapi trial creds: link via QR in Settings; send a text to a test number
  → row `sent` + providerMessageId; simulate inbound + status webhooks → correct
  threading/status.
- Leads + client threads render and send; non-WhatsApp flows unchanged.
- `npm run build` / `tsc --noEmit` clean. Remove any temp verify routes.

---

## Risk notes
- **Unofficial/ToS + ban risk** — surfaced in Settings copy; not a code concern.
- **Inbound depends on public hosting** — outbound is fully testable now; gate
  the inbound end-to-end check on deployment.
- **Provider creds are secrets** — store in settings/env, never log the token;
  webhook is secret-verified.
- **Phone matching** is the fiddly bit — normalise both sides; have an explicit
  fallback (park unmatched inbound on a whatsapp lead) so nothing is dropped.
- Repo not under git → verify per-phase before moving on.
